/**
 * cli_runner.ts — Command-Line Task Executor
 *
 * MVP interface for running tasks end-to-end without the dashboard.
 * Creates a task, runs it through the state machine, and reports results.
 *
 * Usage:
 *   npx ts-node System/cli_runner.ts --task "Research competitors" \
 *     --connector notebooklm_connector \
 *     --project my-campaign \
 *     --urls "https://example1.com,https://example2.com"
 *
 * Or interactively:
 *   npx ts-node System/cli_runner.ts
 */

import { TaskStateManager } from "./task_state";
import { NotebookLMConnector } from "../Tools/Connectors/notebooklm_connector";
import { AuthManager } from "../Tools/Utilities/auth_manager";
import { Notifier } from "../Tools/Utilities/notifier";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const ROOT_DIR = path.resolve(__dirname, "..");

interface CLIArgs {
    task: string;
    connector: string;
    project: string;
    urls?: string[];
    question?: string;
    sandbox?: boolean;
    autoApprove?: boolean;
}

function parseArgs(): CLIArgs {
    const args = process.argv.slice(2);
    const parsed: Partial<CLIArgs> = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--task":
                parsed.task = args[++i];
                break;
            case "--connector":
                parsed.connector = args[++i];
                break;
            case "--project":
                parsed.project = args[++i];
                break;
            case "--urls":
                parsed.urls = args[++i]?.split(",").map((u) => u.trim());
                break;
            case "--question":
                parsed.question = args[++i];
                break;
            case "--sandbox":
                parsed.sandbox = args[++i] !== "false";
                break;
            case "--auto-approve":
                parsed.autoApprove = true;
                break;
            case "--help":
                printHelp();
                process.exit(0);
        }
    }

    // Defaults
    return {
        task: parsed.task || "Unnamed task",
        connector: parsed.connector || "notebooklm_connector",
        project: parsed.project || `project-${Date.now()}`,
        urls: parsed.urls,
        question: parsed.question || "General research query",
        sandbox: parsed.sandbox !== undefined ? parsed.sandbox : true,
        autoApprove: parsed.autoApprove || false,
    };
}

function printHelp(): void {
    console.log(`
╔══════════════════════════════════════════════════════╗
║         BOS CLI Runner — Task Executor               ║
╚══════════════════════════════════════════════════════╝

Usage:
  npx ts-node System/cli_runner.ts [options]

Options:
  --task <title>         Task title/description
  --connector <name>     Connector to use (default: notebooklm_connector)
  --project <name>       Project name (creates directory if needed)
  --urls <url1,url2>     Comma-separated URLs for research
  --question <query>     Research question
  --sandbox <true|false> Run in sandbox mode (default: true)
  --auto-approve         Skip human approval gates (for testing)
  --help                 Show this help message

Example:
  npx ts-node System/cli_runner.ts \\
    --task "Analyze competitor pricing" \\
    --connector notebooklm_connector \\
    --project apollo-q1 \\
    --urls "https://competitor1.com,https://competitor2.com" \\
    --question "What pricing strategies are used?"
`);
}

async function run(): Promise<void> {
    const args = parseArgs();
    const notifier = new Notifier();
    const stateManager = new TaskStateManager(ROOT_DIR);

    console.log(`
╔══════════════════════════════════════════════════════╗
║           BOS CLI Runner — Starting Task              ║
╚══════════════════════════════════════════════════════╝
`);

    // --- Step 1: Create Task ---
    const taskId = `task_${Date.now()}_${uuidv4().slice(0, 4)}`;
    console.log(`[cli] Creating task: ${args.task} (${taskId})`);

    const state = stateManager.create(
        args.project,
        taskId,
        args.task,
        `CLI-initiated task using ${args.connector}`,
        args.connector,
        { urls: args.urls || [], question: args.question },
        "MEDIUM"
    );

    console.log(`[cli] Task created in project: ${args.project}`);
    console.log(`[cli] Status: ${state.status}`);

    // --- Step 2: Request Approval ---
    stateManager.transition(args.project, "AWAITING_HUMAN_APPROVAL", "nanoclaw", "Task ready for review");
    await notifier.requestApproval(`Task "${args.task}" is ready for review.`, { taskId });

    if (args.autoApprove) {
        console.log("[cli] Auto-approve enabled — skipping human gate.");
        stateManager.transition(args.project, "APPROVED", "system", "Auto-approved via CLI");
    } else {
        console.log("[cli] ⏸️  Task is now AWAITING_HUMAN_APPROVAL.");
        console.log("[cli]    Approve via dashboard at http://localhost:3000/approvals");
        console.log("[cli]    Or re-run with --auto-approve to skip the gate.");

        // Load final state and print summary before exiting
        const pendingState = stateManager.load(args.project);
        console.log(`
╔══════════════════════════════════════════════════════╗
║           Task Awaiting Approval                      ║
╠══════════════════════════════════════════════════════╣
║ Task ID:    ${pendingState.task_id.padEnd(40)}║
║ Project:    ${pendingState.project.padEnd(40)}║
║ Status:     ${pendingState.status.padEnd(40)}║
╚══════════════════════════════════════════════════════╝
`);
        return; // Exit — dashboard handles the rest
    }

    // --- Step 3: Execute ---
    stateManager.transition(args.project, "IN_PROGRESS", "nanoclaw", "Starting execution");
    console.log(`\n[cli] Executing connector: ${args.connector}`);
    console.log(`[cli] Sandbox mode: ${args.sandbox}`);

    let result;
    try {
        // Load auth (won't throw if .env doesn't exist — just warns)
        let auth: AuthManager;
        try {
            auth = new AuthManager();
        } catch {
            auth = new AuthManager([]); // No required keys for MVP
        }

        // Get connector
        const connector = getConnector(args.connector, auth, args.sandbox!);

        // Authenticate
        const authOk = await connector.authenticate();
        console.log(`[cli] Authentication: ${authOk ? "✅ Passed" : "⚠️ Skipped (MVP mode)"}`);

        // Execute pull
        result = await connector.pull({
            urls: args.urls || [],
            question: args.question,
            taskId,
        });

        if (result.success) {
            console.log(`\n[cli] ✅ Execution completed in ${result.duration_ms}ms`);
            console.log(`[cli] Result:`, JSON.stringify(result.data, null, 2));

            // Write output if not sandbox
            if (!args.sandbox && connector instanceof NotebookLMConnector) {
                const outputPath = await connector.writeResearchOutput(args.project, result.data);
                console.log(`[cli] Output written to: ${outputPath}`);
            }

            stateManager.transition(
                args.project,
                "AWAITING_REVIEW",
                "nanoclaw",
                `Completed in ${result.duration_ms}ms`
            );

            await notifier.info(`Task "${args.task}" completed. Ready for review.`, { taskId });
        } else {
            throw new Error(result.error || "Unknown execution error");
        }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`\n[cli] ❌ Execution failed: ${errorMsg}`);

        stateManager.transition(args.project, "FAILED", "nanoclaw", errorMsg);
        await notifier.critical(`Task "${args.task}" FAILED: ${errorMsg}`, { taskId });
    }

    // --- Step 4: Summary ---
    const finalState = stateManager.load(args.project);
    console.log(`
╔══════════════════════════════════════════════════════╗
║                   Task Summary                        ║
╠══════════════════════════════════════════════════════╣
║ Task ID:    ${finalState.task_id.padEnd(40)}║
║ Project:    ${finalState.project.padEnd(40)}║
║ Status:     ${finalState.status.padEnd(40)}║
║ Transitions: ${String(finalState.history.length).padEnd(38)}║
╚══════════════════════════════════════════════════════╝
`);
}

function getConnector(name: string, auth: AuthManager, sandbox: boolean) {
    switch (name) {
        case "notebooklm_connector":
            return new NotebookLMConnector(auth.getConfig([]), sandbox);
        default:
            throw new Error(`Unknown connector: ${name}. Available: notebooklm_connector`);
    }
}

// Run
run().catch((err) => {
    console.error("[cli] Fatal error:", err);
    process.exit(1);
});
