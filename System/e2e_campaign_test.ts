/**
 * e2e_campaign_test.ts — Full Campaign Lifecycle Test
 *
 * Simulates an entire campaign from DRAFT to COMPLETE, testing:
 *   1. All 10 state transitions in sequence
 *   2. SQLite logging of every transition
 *   3. Connector execution (sandbox mode)
 *   4. Output file generation
 *   5. Learning note creation
 *   6. Full history trail integrity
 *
 * Usage:
 *   npx ts-node System/e2e_campaign_test.ts
 *
 * Cleans up test data on success.
 */

import { TaskStateManager } from "./task_state";
import { NotebookLMConnector } from "../Tools/Connectors/notebooklm_connector";
import { writeLearning } from "./learning_writer";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const ROOT_DIR = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT_DIR, "Memory", "local_state.sqlite");
const TEST_PROJECT = `e2e-test-${Date.now()}`;

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean): void {
    try {
        const result = fn();
        if (result) {
            console.log(`  ✅ ${name}`);
            passed++;
        } else {
            console.log(`  ❌ ${name} — returned false`);
            failed++;
        }
    } catch (err) {
        console.log(`  ❌ ${name} — ${err instanceof Error ? err.message : err}`);
        failed++;
    }
}

async function testAsync(name: string, fn: () => Promise<boolean>): Promise<void> {
    try {
        const result = await fn();
        if (result) {
            console.log(`  ✅ ${name}`);
            passed++;
        } else {
            console.log(`  ❌ ${name} — returned false`);
            failed++;
        }
    } catch (err) {
        console.log(`  ❌ ${name} — ${err instanceof Error ? err.message : err}`);
        failed++;
    }
}

async function runE2E(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════════════════╗
║       BOS E2E Campaign Test — Full Lifecycle         ║
╠══════════════════════════════════════════════════════╣
║ Project: ${TEST_PROJECT.padEnd(42)}║
╚══════════════════════════════════════════════════════╝
`);

    const stateManager = new TaskStateManager(ROOT_DIR);
    const taskId = `e2e_${Date.now()}`;
    const startTime = Date.now();

    // ══════════════════════════════════════════
    // STAGE 1: Task Creation
    // ══════════════════════════════════════════
    console.log("\n📋 Stage 1: Task Creation");

    test("1.1 Create task (DRAFT)", () => {
        const state = stateManager.create(
            TEST_PROJECT,
            taskId,
            "E2E Test: Q1 Competitor Analysis",
            "End-to-end campaign test verifying full lifecycle",
            "notebooklm_connector",
            {
                urls: ["https://competitor1.example.com", "https://competitor2.example.com"],
                question: "What pricing strategies do competitors use?",
            },
            "HIGH"
        );
        return state.status === "DRAFT" && state.history.length === 1;
    });

    // ══════════════════════════════════════════
    // STAGE 2: Human Approval Gate
    // ══════════════════════════════════════════
    console.log("\n🔒 Stage 2: Human Approval Gate");

    test("2.1 Transition DRAFT → AWAITING_HUMAN_APPROVAL", () => {
        const state = stateManager.transition(TEST_PROJECT, "AWAITING_HUMAN_APPROVAL", "nanoclaw", "Task ready for review");
        return state.status === "AWAITING_HUMAN_APPROVAL";
    });

    test("2.2 Transition AWAITING_HUMAN_APPROVAL → APPROVED", () => {
        const state = stateManager.transition(TEST_PROJECT, "APPROVED", "human", "Approved by human operator");
        return (
            state.status === "APPROVED" &&
            state.approved_by === "human_operator" &&
            state.approved_at !== null
        );
    });

    // ══════════════════════════════════════════
    // STAGE 3: Connector Execution
    // ══════════════════════════════════════════
    console.log("\n⚡ Stage 3: Connector Execution");

    test("3.1 Transition APPROVED → IN_PROGRESS", () => {
        const state = stateManager.transition(TEST_PROJECT, "IN_PROGRESS", "nanoclaw", "Starting execution");
        return state.status === "IN_PROGRESS";
    });

    let connectorResult: any;
    await testAsync("3.2 Execute NotebookLM connector (sandbox)", async () => {
        const connector = new NotebookLMConnector({}, true); // sandbox=true
        const authOk = await connector.authenticate();
        if (!authOk) return false;

        connectorResult = await connector.pull({
            urls: ["https://competitor1.example.com", "https://competitor2.example.com"],
            question: "What pricing strategies do competitors use?",
            taskId,
        });

        return connectorResult.success === true && connectorResult.sandbox === true;
    });

    test("3.3 Transition IN_PROGRESS → AWAITING_REVIEW", () => {
        const duration = connectorResult?.duration_ms || 0;
        const state = stateManager.transition(
            TEST_PROJECT,
            "AWAITING_REVIEW",
            "nanoclaw",
            `Completed in ${duration}ms`
        );
        return state.status === "AWAITING_REVIEW";
    });

    // ══════════════════════════════════════════
    // STAGE 4: Review & Distribution
    // ══════════════════════════════════════════
    console.log("\n📦 Stage 4: Review & Distribution");

    test("4.1 Transition AWAITING_REVIEW → APPROVED_FOR_DISTRIBUTION", () => {
        const state = stateManager.transition(
            TEST_PROJECT,
            "APPROVED_FOR_DISTRIBUTION",
            "human",
            "Content quality verified"
        );
        return state.status === "APPROVED_FOR_DISTRIBUTION";
    });

    test("4.2 Transition APPROVED_FOR_DISTRIBUTION → IN_PROGRESS_DISTRIBUTION", () => {
        const state = stateManager.transition(
            TEST_PROJECT,
            "IN_PROGRESS_DISTRIBUTION",
            "nanoclaw",
            "Starting distribution"
        );
        return state.status === "IN_PROGRESS_DISTRIBUTION";
    });

    test("4.3 Transition IN_PROGRESS_DISTRIBUTION → REPORTING", () => {
        const state = stateManager.transition(TEST_PROJECT, "REPORTING", "nanoclaw", "Distribution complete");
        return state.status === "REPORTING";
    });

    test("4.4 Transition REPORTING → COMPLETE", () => {
        const state = stateManager.transition(TEST_PROJECT, "COMPLETE", "nanoclaw", "Campaign finished");
        return state.status === "COMPLETE";
    });

    // ══════════════════════════════════════════
    // STAGE 5: Output & Learning Verification
    // ══════════════════════════════════════════
    console.log("\n📝 Stage 5: Output & Learning Verification");

    test("5.1 Project directory exists with Research + Output folders", () => {
        const projectDir = path.join(ROOT_DIR, "Projects", TEST_PROJECT);
        return (
            fs.existsSync(path.join(projectDir, "Research")) &&
            fs.existsSync(path.join(projectDir, "Output"))
        );
    });

    test("5.2 task_state.json has full history trail (9 transitions)", () => {
        const state = stateManager.load(TEST_PROJECT);
        // 1 create (→DRAFT) + 8 transitions = 9 history entries
        return state.history.length === 9 && state.status === "COMPLETE";
    });

    test("5.3 Learning note generated", () => {
        const totalDuration = Date.now() - startTime;
        const filepath = writeLearning({
            task_id: taskId,
            project: TEST_PROJECT,
            title: "E2E Test: Q1 Competitor Analysis",
            connector: "notebooklm_connector",
            duration_ms: totalDuration,
            success: true,
            transitions_count: 9,
            quality_score: 8,
            notes: "Full lifecycle test — all state transitions verified.",
        });
        return fs.existsSync(filepath);
    });

    test("5.4 SQLite has transition logs", () => {
        if (!fs.existsSync(DB_PATH)) return false;
        const db = new Database(DB_PATH);
        const row = db
            .prepare("SELECT COUNT(*) as cnt FROM state_transitions WHERE task_id = ?")
            .get(taskId) as { cnt: number };
        db.close();
        // 9 transitions: create→DRAFT + 8 explicit transitions
        return row.cnt === 9;
    });

    // ══════════════════════════════════════════
    // STAGE 6: Invalid Transition Guard
    // ══════════════════════════════════════════
    console.log("\n🛡️ Stage 6: Guard Rails");

    test("6.1 Rejects invalid transition (COMPLETE → DRAFT)", () => {
        try {
            stateManager.transition(TEST_PROJECT, "DRAFT", "system", "Should fail");
            return false; // Should have thrown
        } catch (err) {
            return (err instanceof Error && err.message.includes("Invalid transition"));
        }
    });

    test("6.2 Rejects invalid transition (COMPLETE → IN_PROGRESS)", () => {
        try {
            stateManager.transition(TEST_PROJECT, "IN_PROGRESS", "system", "Should fail");
            return false;
        } catch (err) {
            return (err instanceof Error && err.message.includes("Invalid transition"));
        }
    });

    // ══════════════════════════════════════════
    // CLEANUP
    // ══════════════════════════════════════════
    console.log("\n🧹 Cleanup");

    test("7.1 Remove test project directory", () => {
        const projectDir = path.join(ROOT_DIR, "Projects", TEST_PROJECT);
        if (fs.existsSync(projectDir)) {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
        return !fs.existsSync(projectDir);
    });

    // ══════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`
╔══════════════════════════════════════════════════════╗
║  E2E Campaign Test Results                            ║
╠══════════════════════════════════════════════════════╣
║  Passed: ${String(passed).padEnd(4)} Failed: ${String(failed).padEnd(4)}                      ║
║  Duration: ${totalDuration.padEnd(6)}s                                  ║
║  Status: ${(failed === 0 ? "✅ ALL PASSED" : "❌ FAILURES DETECTED").padEnd(40)}║
╚══════════════════════════════════════════════════════╝
`);

    process.exit(failed > 0 ? 1 : 0);
}

// Run
runE2E().catch((err) => {
    console.error("[e2e] Fatal error:", err);
    process.exit(1);
});
