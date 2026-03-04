/**
 * task_state.ts — Task State Machine Validator & Manager
 *
 * Manages task_state.json lifecycle with:
 *   - Schema validation via Zod
 *   - State transition enforcement
 *   - History tracking for audit trail
 *   - SQLite logging of all transitions
 */

import { z } from "zod";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// === Task Status Enum ===
export const TASK_STATUSES = [
    "DRAFT",
    "AWAITING_HUMAN_APPROVAL",
    "APPROVED",
    "IN_PROGRESS",
    "AWAITING_REVIEW",
    "FAILED",
    "AWAITING_RETRY",
    "REJECTED",
    "APPROVED_FOR_DISTRIBUTION",
    "IN_PROGRESS_DISTRIBUTION",
    "REPORTING",
    "COMPLETE",
    "CANCELLED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

// === Valid State Transitions ===
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    DRAFT: ["AWAITING_HUMAN_APPROVAL"],
    AWAITING_HUMAN_APPROVAL: ["APPROVED", "CANCELLED"],
    APPROVED: ["IN_PROGRESS"],
    IN_PROGRESS: ["AWAITING_REVIEW", "FAILED"],
    AWAITING_REVIEW: ["APPROVED_FOR_DISTRIBUTION", "REJECTED"],
    FAILED: ["AWAITING_RETRY", "CANCELLED"],
    AWAITING_RETRY: ["IN_PROGRESS", "CANCELLED"],
    REJECTED: ["DRAFT"],
    APPROVED_FOR_DISTRIBUTION: ["IN_PROGRESS_DISTRIBUTION"],
    IN_PROGRESS_DISTRIBUTION: ["REPORTING", "FAILED"],
    REPORTING: ["COMPLETE"],
    COMPLETE: [],
    CANCELLED: [],
};

// === Zod Schema ===
const HistoryEntrySchema = z.object({
    from: z.string().nullable(),
    to: z.string(),
    timestamp: z.string(),
    actor: z.enum(["nanoclaw", "antigravity", "human", "system"]),
    reason: z.string().optional(),
});

export const TaskStateSchema = z.object({
    task_id: z.string().min(1),
    project: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    created_at: z.string(),
    updated_at: z.string(),
    assigned_to: z.enum(["nanoclaw", "antigravity"]),
    approved_by: z.string().nullable(),
    approved_at: z.string().nullable(),
    connector: z.string(),
    input_payload: z.record(z.any()),
    output_path: z.string(),
    error: z.string().nullable(),
    retry_count: z.number().int().min(0),
    max_retries: z.number().int().min(0),
    history: z.array(HistoryEntrySchema),
});

export type TaskState = z.infer<typeof TaskStateSchema>;

// === Task State Manager ===
export class TaskStateManager {
    private projectsDir: string;
    private dbPath: string;

    constructor(rootDir: string) {
        this.projectsDir = path.join(rootDir, "Projects");
        this.dbPath = path.join(rootDir, "Memory", "local_state.sqlite");
    }

    /**
     * Load and validate a task_state.json for a project.
     */
    load(projectName: string): TaskState {
        const filepath = path.join(this.projectsDir, projectName, "task_state.json");

        if (!fs.existsSync(filepath)) {
            throw new Error(`task_state.json not found for project: ${projectName}`);
        }

        const raw = JSON.parse(fs.readFileSync(filepath, "utf-8"));
        const result = TaskStateSchema.safeParse(raw);

        if (!result.success) {
            throw new Error(
                `Invalid task_state.json for ${projectName}: ${result.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join(", ")}`
            );
        }

        return result.data;
    }

    /**
     * Save a task state to disk.
     */
    save(projectName: string, state: TaskState): void {
        const dirPath = path.join(this.projectsDir, projectName);
        const filepath = path.join(dirPath, "task_state.json");

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        state.updated_at = new Date().toISOString();
        fs.writeFileSync(filepath, JSON.stringify(state, null, 2), "utf-8");
    }

    /**
     * Transition a task to a new status with validation.
     *
     * @throws Error if the transition is not valid
     */
    transition(
        projectName: string,
        toStatus: TaskStatus,
        actor: "nanoclaw" | "antigravity" | "human" | "system",
        reason?: string
    ): TaskState {
        const state = this.load(projectName);
        const fromStatus = state.status;

        // Validate transition
        const allowedTransitions = VALID_TRANSITIONS[fromStatus];
        if (!allowedTransitions.includes(toStatus)) {
            throw new Error(
                `Invalid transition: ${fromStatus} → ${toStatus}. ` +
                `Allowed: ${allowedTransitions.join(", ") || "none (terminal state)"}`
            );
        }

        // Apply transition
        state.status = toStatus;
        state.history.push({
            from: fromStatus,
            to: toStatus,
            timestamp: new Date().toISOString(),
            actor,
            reason,
        });

        // Handle specific transitions
        if (toStatus === "FAILED") {
            state.error = reason || "Unknown error";
        }
        if (toStatus === "AWAITING_RETRY") {
            state.retry_count++;
        }
        if (toStatus === "IN_PROGRESS" && fromStatus === "AWAITING_RETRY") {
            state.error = null; // Clear error on retry
        }
        if (toStatus === "APPROVED") {
            state.approved_by = actor === "human" ? "human_operator" : actor;
            state.approved_at = new Date().toISOString();
        }

        // Save to disk
        this.save(projectName, state);

        // Log to SQLite
        this.logTransition(state.task_id, fromStatus, toStatus, actor, reason);

        console.log(
            `[task_state] ${state.task_id}: ${fromStatus} → ${toStatus} (by ${actor})`
        );

        return state;
    }

    /**
     * Create a new task for a project.
     */
    create(
        projectName: string,
        taskId: string,
        title: string,
        description: string,
        connector: string,
        inputPayload: Record<string, any> = {},
        priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM"
    ): TaskState {
        const now = new Date().toISOString();

        const state: TaskState = {
            task_id: taskId,
            project: projectName,
            title,
            description,
            status: "DRAFT",
            priority,
            created_at: now,
            updated_at: now,
            assigned_to: "nanoclaw",
            approved_by: null,
            approved_at: null,
            connector,
            input_payload: inputPayload,
            output_path: `Projects/${projectName}/Output/`,
            error: null,
            retry_count: 0,
            max_retries: 3,
            history: [
                {
                    from: null,
                    to: "DRAFT",
                    timestamp: now,
                    actor: "nanoclaw",
                },
            ],
        };

        // Ensure project directory exists
        const projectDir = path.join(this.projectsDir, projectName);
        for (const sub of ["Research", "Output"]) {
            const dir = path.join(projectDir, sub);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        this.save(projectName, state);
        this.logTransition(taskId, null, "DRAFT", "nanoclaw", "Task created");

        return state;
    }

    /**
     * Check if a transition is valid without performing it.
     */
    canTransition(currentStatus: TaskStatus, toStatus: TaskStatus): boolean {
        return VALID_TRANSITIONS[currentStatus]?.includes(toStatus) || false;
    }

    private logTransition(
        taskId: string,
        fromStatus: string | null,
        toStatus: string,
        actor: string,
        reason?: string
    ): void {
        try {
            if (!fs.existsSync(this.dbPath)) return;

            const db = new Database(this.dbPath);
            db.pragma("journal_mode = WAL");

            db.prepare(
                `INSERT INTO state_transitions (task_id, from_status, to_status, actor, reason)
         VALUES (?, ?, ?, ?, ?)`
            ).run(taskId, fromStatus, toStatus, actor, reason || null);

            db.close();
        } catch (err) {
            console.error("[task_state] Failed to log transition to SQLite:", err);
        }
    }
}
