/**
 * task_watcher.ts — File Watcher for Auto-Execution
 *
 * Background service that watches Projects/<project>/task_state.json files
    * for state changes and auto - advances the workflow after human approval.
 *
 * Behavior:
 * - APPROVED: Automatically starts connector execution → IN_PROGRESS
    * - IN_PROGRESS → AWAITING_REVIEW: Happens after connector execution
        * - Human checkpoints(AWAITING_HUMAN_APPROVAL, AWAITING_REVIEW) remain manual
            *
 * Uses chokidar for file watching.Broadcasts state changes to WebSocket.
 *
 * Usage:
 *   import { TaskWatcher } from './task_watcher';
 *   const watcher = new TaskWatcher(broadcastFn);
 * watcher.start();
 */

import chokidar from "chokidar";
import path from "path";
import fs from "fs";
import { TaskStateManager, type TaskStatus } from "./task_state";
import { NotebookLMConnector } from "../Tools/Connectors/notebooklm_connector";
import { writeLearning } from "./learning_writer";

const ROOT_DIR = path.resolve(__dirname, "..");
const PROJECTS_DIR = path.join(ROOT_DIR, "Projects");

export type BroadcastFn = (message: Record<string, any>) => void;

export class TaskWatcher {
    private stateManager: TaskStateManager;
    private watcher: chokidar.FSWatcher | null = null;
    private broadcastFn: BroadcastFn;
    private processing: Set<string> = new Set(); // Prevent re-entrant execution
    private lastContent: Map<string, string> = new Map(); // Debounce duplicate events

    constructor(broadcastFn: BroadcastFn) {
        this.stateManager = new TaskStateManager(ROOT_DIR);
        this.broadcastFn = broadcastFn;
    }

    /**
     * Start watching for task_state.json changes.
     */
    start(): void {
        const watchPattern = path.join(PROJECTS_DIR, "*", "task_state.json").replace(/\\/g, "/");

        this.watcher = chokidar.watch(watchPattern, {
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100,
            },
        });

        this.watcher.on("change", (filepath) => this.handleChange(filepath));
        this.watcher.on("add", (filepath) => this.handleChange(filepath));

        console.log("[task_watcher] 👀 Watching for task_state.json changes...");
    }

    /**
     * Stop the watcher.
     */
    async stop(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
            console.log("[task_watcher] Stopped.");
        }
    }

    /**
     * Handle a file change event.
     */
    private async handleChange(filepath: string): Promise<void> {
        try {
            // Extract project name from path
            const projectName = path.basename(path.dirname(filepath));

            // Skip template directories
            if (projectName.startsWith("_")) return;

            // Debounce: skip if content hasn't actually changed
            const content = fs.readFileSync(filepath, "utf-8");
            if (this.lastContent.get(projectName) === content) return;
            this.lastContent.set(projectName, content);

            // Parse the state
            const state = JSON.parse(content);
            const status: TaskStatus = state.status;

            console.log(`[task_watcher] Change detected: ${projectName} → ${status}`);

            // Broadcast the change to WebSocket clients
            this.broadcastFn({
                type: "state_change",
                task_id: state.task_id,
                project: projectName,
                status,
                timestamp: new Date().toISOString(),
            });

            // Auto-advance based on status
            await this.autoAdvance(projectName, state);
        } catch (err) {
            console.error("[task_watcher] Error processing change:", err);
        }
    }

    /**
     * Auto-advance the workflow based on current status.
     * Only auto-advances deterministic steps (not human checkpoints).
     */
    private async autoAdvance(
        projectName: string,
        state: Record<string, any>
    ): Promise<void> {
        const status: TaskStatus = state.status;

        // Prevent re-entrant execution
        if (this.processing.has(projectName)) {
            console.log(`[task_watcher] Already processing ${projectName}, skipping.`);
            return;
        }

        switch (status) {
            case "APPROVED":
                await this.executeTask(projectName, state);
                break;

            case "APPROVED_FOR_DISTRIBUTION":
                await this.executeDistribution(projectName, state);
                break;

            case "COMPLETE":
                await this.onComplete(projectName, state);
                break;

            // Human checkpoints — do nothing, wait for dashboard approval
            case "AWAITING_HUMAN_APPROVAL":
            case "AWAITING_REVIEW":
                console.log(`[task_watcher] ${projectName}: Waiting for human action at ${status}`);
                break;

            default:
                // No auto-action for other states
                break;
        }
    }

    /**
     * Execute a connector task after approval.
     * APPROVED → IN_PROGRESS → AWAITING_REVIEW (or FAILED)
     */
    private async executeTask(
        projectName: string,
        state: Record<string, any>
    ): Promise<void> {
        this.processing.add(projectName);

        try {
            // Transition to IN_PROGRESS
            this.stateManager.transition(projectName, "IN_PROGRESS", "nanoclaw", "Auto-started after approval");

            this.broadcastFn({
                type: "execution_started",
                task_id: state.task_id,
                project: projectName,
                connector: state.connector,
                timestamp: new Date().toISOString(),
            });

            // Get connector
            const connector = this.getConnector(state.connector, true);
            if (!connector) {
                throw new Error(`Unknown connector: ${state.connector}`);
            }

            // Authenticate
            await connector.authenticate();

            // Execute pull
            const startTime = Date.now();
            const result = await connector.pull({
                ...state.input_payload,
                taskId: state.task_id,
            });

            const durationMs = Date.now() - startTime;

            if (result.success) {
                // Write output
                if (connector instanceof NotebookLMConnector) {
                    await connector.writeResearchOutput(projectName, result.data);
                }

                // Transition to AWAITING_REVIEW
                this.stateManager.transition(
                    projectName,
                    "AWAITING_REVIEW",
                    "nanoclaw",
                    `Completed in ${durationMs}ms`
                );

                this.broadcastFn({
                    type: "execution_complete",
                    task_id: state.task_id,
                    project: projectName,
                    duration_ms: durationMs,
                    success: true,
                    timestamp: new Date().toISOString(),
                });

                console.log(`[task_watcher] ✅ ${projectName}: Execution complete (${durationMs}ms)`);
            } else {
                throw new Error(result.error || "Unknown execution error");
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[task_watcher] ❌ ${projectName}: Execution failed — ${errorMsg}`);

            try {
                this.stateManager.transition(projectName, "FAILED", "nanoclaw", errorMsg);
            } catch {
                // State might already be in a terminal state
            }

            this.broadcastFn({
                type: "execution_failed",
                task_id: state.task_id,
                project: projectName,
                error: errorMsg,
                timestamp: new Date().toISOString(),
            });
        } finally {
            this.processing.delete(projectName);
        }
    }

    /**
     * Execute distribution phase.
     * APPROVED_FOR_DISTRIBUTION → IN_PROGRESS_DISTRIBUTION → REPORTING
     */
    private async executeDistribution(
        projectName: string,
        state: Record<string, any>
    ): Promise<void> {
        this.processing.add(projectName);

        try {
            this.stateManager.transition(
                projectName,
                "IN_PROGRESS_DISTRIBUTION",
                "nanoclaw",
                "Starting distribution"
            );

            this.broadcastFn({
                type: "distribution_started",
                task_id: state.task_id,
                project: projectName,
                timestamp: new Date().toISOString(),
            });

            // In MVP: Simulated distribution (2s delay)
            await new Promise((resolve) => setTimeout(resolve, 2000));

            this.stateManager.transition(
                projectName,
                "REPORTING",
                "nanoclaw",
                "Distribution complete"
            );

            // Auto-complete reporting (MVP)
            await new Promise((resolve) => setTimeout(resolve, 500));

            this.stateManager.transition(
                projectName,
                "COMPLETE",
                "nanoclaw",
                "Campaign finished"
            );

            console.log(`[task_watcher] ✅ ${projectName}: Distribution + reporting complete`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[task_watcher] ❌ ${projectName}: Distribution failed — ${errorMsg}`);

            try {
                this.stateManager.transition(projectName, "FAILED", "nanoclaw", errorMsg);
            } catch {
                // Ignore
            }
        } finally {
            this.processing.delete(projectName);
        }
    }

    /**
     * On task completion: generate learning note.
     */
    private async onComplete(
        projectName: string,
        state: Record<string, any>
    ): Promise<void> {
        try {
            const history = state.history || [];
            const created = new Date(state.created_at).getTime();
            const totalDuration = Date.now() - created;

            writeLearning({
                task_id: state.task_id,
                project: projectName,
                title: state.title,
                connector: state.connector,
                duration_ms: totalDuration,
                success: true,
                transitions_count: history.length,
                quality_score: 7,
                notes: "Auto-generated on task completion.",
            });

            this.broadcastFn({
                type: "learning_generated",
                task_id: state.task_id,
                project: projectName,
                timestamp: new Date().toISOString(),
            });

            console.log(`[task_watcher] 📝 ${projectName}: Learning note generated`);
        } catch (err) {
            console.error("[task_watcher] Failed to write learning:", err);
        }
    }

    /**
     * Get a connector instance by name.
     */
    private getConnector(name: string, sandbox: boolean) {
        switch (name) {
            case "notebooklm_connector":
                return new NotebookLMConnector({}, sandbox);
            default:
                return null;
        }
    }
}

// Start the watcher
const watcher = new TaskWatcher((msg) => {
    console.log("[task_watcher] Broadcast:", JSON.stringify(msg));
});
watcher.start();
