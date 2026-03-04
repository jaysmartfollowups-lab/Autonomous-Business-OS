/**
 * mcp_server.ts — Model Context Protocol Server
 *
 * Exposes BOS tools to Antigravity via the MCP standard.
 * Port 3002
 *
 * Tools:
 *   - trigger_nanoclaw_sandbox: Execute a connector task in a Docker sandbox
 *   - list_projects: Get all projects and their statuses
 *   - get_task_state: Get a specific project's task state
 *   - transition_task: Approve/reject a task (human action proxy)
 *
 * Note: This is a simplified HTTP-based MCP server for MVP.
 * For production, use @modelcontextprotocol/sdk with stdio transport.
 */

import express from "express";
import { TaskStateManager, type TaskStatus } from "./task_state";
import { NotebookLMConnector } from "../Tools/Connectors/notebooklm_connector";
import { Notifier } from "../Tools/Utilities/notifier";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";

const execAsync = promisify(exec);

const MCP_PORT = parseInt(process.env.MCP_PORT || "3002", 10);
const ROOT_DIR = path.resolve(__dirname, "..");
const PROJECTS_DIR = path.join(ROOT_DIR, "Projects");

const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});

const stateManager = new TaskStateManager(ROOT_DIR);
const notifier = new Notifier();

// === MCP Tool Registry ===
interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    handler: (input: Record<string, any>) => Promise<Record<string, any>>;
}

const tools: MCPToolDefinition[] = [
    {
        name: "trigger_nanoclaw_sandbox",
        description:
            "Triggers a NanoClaw task in a Docker sandbox. Creates a project, runs the specified connector, and returns results.",
        inputSchema: {
            type: "object",
            required: ["task_id", "connector_name"],
            properties: {
                task_id: { type: "string", description: "Unique task identifier" },
                connector_name: { type: "string", description: "Connector to execute" },
                action: {
                    type: "string",
                    enum: ["authenticate", "push", "pull", "status", "dry_run"],
                    default: "pull",
                },
                payload: { type: "object", description: "Input data for the connector" },
                sandbox: { type: "boolean", default: true },
                timeout_seconds: { type: "number", default: 300 },
            },
        },
        handler: async (input) => {
            const {
                task_id,
                connector_name,
                action = "pull",
                payload = {},
                sandbox = true,
            } = input;

            const projectName = `mcp-${task_id}`;

            // Create task
            stateManager.create(
                projectName,
                task_id,
                `MCP triggered: ${connector_name}::${action}`,
                `Description: Execute ${connector_name} action ${action}`,
                connector_name,
                payload,
                "MEDIUM"
            );
            let state = stateManager.load(projectName);

            // Auto transition to "IN_PROGRESS" for the sandbox if it's new
            if (state.status === "DRAFT") {
                stateManager.transition(projectName, "AWAITING_HUMAN_APPROVAL", "nanoclaw");
                stateManager.transition(projectName, "APPROVED", "antigravity", "MCP auto-approved");
                stateManager.transition(projectName, "IN_PROGRESS", "nanoclaw");
            } else if (state.status === "APPROVED") {
                stateManager.transition(projectName, "IN_PROGRESS", "nanoclaw");
            }

            // Execute connector via NanoClaw Sandbox WSL Bridge
            try {
                let result;

                if (sandbox) {
                    console.log(`[mcp] Handing off to NanoClaw sandbox via WSL sqlite3`);

                    const payloadStr = JSON.stringify(payload).replace(/'/g, "''"); // escape SQL single quotes
                    const prompt = `@NanoClaw [MCP AUTOMATED TASK] Connector: ${connector_name}. Action: ${action}. TaskID: ${task_id}. Payload: ${payloadStr}`;

                    // We target NanoClaw's registered Telegram Chat ID directly here.
                    const chatJid = "tg:6674448518"; // My registered Telegram chat ID

                    // Use WSL command to insert into NanoClaw's database
                    const sql = `INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (hex(randomblob(16)), '${chatJid}', 'System', 'MCP', '${prompt}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, 0);`;

                    await new Promise<void>((resolve, reject) => {
                        const { spawn } = require("child_process");
                        const proc = spawn("wsl", ["-d", "Ubuntu-24.04", "-u", "root", "-e", "/usr/bin/sqlite3", "/root/NanoClaw/store/messages.db", sql]);
                        let errStr = "";
                        proc.stderr.on("data", (data: any) => errStr += data.toString());
                        proc.on("close", (code: number) => {
                            if (code === 0) resolve();
                            else reject(new Error(`WSL sqlite failed with code ${code}. Error: ${errStr}`));
                        });
                        proc.on("error", reject);
                    });

                    result = {
                        success: true,
                        duration_ms: 100,
                        data: {
                            status: "handed_off_to_nanoclaw",
                            mcp_command_executed: true,
                        }
                    }
                } else {
                    let connector;
                    switch (connector_name) {
                        case "notebooklm_connector":
                            connector = new NotebookLMConnector({}, sandbox);
                            break;
                        default:
                            throw new Error(`Unknown connector: ${connector_name}`);
                    }

                    await connector.authenticate();

                    switch (action) {
                        case "pull":
                            result = await connector.pull({ ...payload, taskId: task_id });
                            break;
                        case "push":
                            result = await connector.push({ ...payload, taskId: task_id });
                            break;
                        case "dry_run":
                            result = await connector.dry_run({ ...payload, taskId: task_id });
                            break;
                        case "status":
                            result = { success: true, data: await connector.status(), duration_ms: 0, sandbox };
                            break;
                        case "authenticate":
                            const authOk = await connector.authenticate();
                            result = { success: authOk, data: { authenticated: authOk }, duration_ms: 0, sandbox };
                            break;
                        default:
                            throw new Error(`Unknown action: ${action}`);
                    }
                }

                stateManager.transition(
                    projectName,
                    "AWAITING_REVIEW",
                    "nanoclaw",
                    `Completed in ${result.duration_ms}ms`
                );

                return {
                    status: "completed",
                    task_id,
                    container_id: `mcp-${uuidv4().slice(0, 8)}`,
                    exit_code: result.success ? 0 : 1,
                    output_path: state.output_path,
                    duration_ms: result.duration_ms,
                    data: result.data,
                };
            } catch (err) {
                console.error("[mcp] Error triggering NanoClaw:", err);
                const errorMsg = err instanceof Error ? err.message : String(err);
                stateManager.transition(projectName, "FAILED", "nanoclaw", errorMsg);

                return {
                    status: "failed",
                    task_id,
                    container_id: null,
                    exit_code: 1,
                    error: errorMsg,
                    retry_eligible: true,
                };
            }
        },
    },
    {
        name: "list_projects",
        description: "List all BOS projects with their current task states.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
            const projects: any[] = [];

            if (!fs.existsSync(PROJECTS_DIR)) return { projects: [] };

            const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
            for (const dir of dirs) {
                if (!dir.isDirectory() || dir.name.startsWith("_")) continue;
                const statePath = path.join(PROJECTS_DIR, dir.name, "task_state.json");
                if (fs.existsSync(statePath)) {
                    try {
                        projects.push({
                            name: dir.name,
                            ...JSON.parse(fs.readFileSync(statePath, "utf-8")),
                        });
                    } catch {
                        projects.push({ name: dir.name, status: "INVALID" });
                    }
                }
            }

            return { projects, total: projects.length };
        },
    },
    {
        name: "get_task_state",
        description: "Get the task state for a specific project.",
        inputSchema: {
            type: "object",
            required: ["project_name"],
            properties: { project_name: { type: "string" } },
        },
        handler: async (input) => {
            return stateManager.load(input.project_name);
        },
    },
    {
        name: "transition_task",
        description:
            "Transition a task to a new status (e.g., approve, reject, cancel).",
        inputSchema: {
            type: "object",
            required: ["project_name", "status", "actor"],
            properties: {
                project_name: { type: "string" },
                status: { type: "string" },
                actor: { type: "string", enum: ["nanoclaw", "antigravity", "human", "system"] },
                reason: { type: "string" },
            },
        },
        handler: async (input) => {
            const state = stateManager.transition(
                input.project_name,
                input.status as TaskStatus,
                input.actor,
                input.reason
            );
            return state;
        },
    },
];

// === MCP Endpoints ===

/**
 * GET /mcp/tools — List available tools (MCP discovery)
 */
app.get("/mcp/tools", (_req, res) => {
    res.json({
        tools: tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
        })),
    });
});

/**
 * POST /mcp/call — Execute a tool (MCP invocation)
 * Body: { tool: "trigger_nanoclaw_sandbox", input: { ... } }
 */
app.post("/mcp/call", async (req, res) => {
    const { tool: toolName, input = {} } = req.body;

    if (!toolName) {
        res.status(400).json({ error: "Missing 'tool' field" });
        return;
    }

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
        res.status(404).json({
            error: `Unknown tool: ${toolName}`,
            available: tools.map((t) => t.name),
        });
        return;
    }

    try {
        console.log(`[mcp] Executing tool: ${toolName}`);
        const result = await tool.handler(input);
        res.json({ tool: toolName, result });
    } catch (err) {
        res.status(500).json({ tool: toolName, error: String(err) });
    }
});

/**
 * GET /mcp/health — MCP server health
 */
app.get("/mcp/health", (_req, res) => {
    res.json({
        status: "ok",
        tools: tools.length,
        timestamp: new Date().toISOString(),
    });
});

// === Start Server ===
app.listen(MCP_PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║          BOS MCP Server — Active                      ║
╠══════════════════════════════════════════════════════╣
║  URL:         http://localhost:${String(MCP_PORT).padEnd(23)}║
║  Tools:       ${tools.map((t) => t.name).join(", ").slice(0, 39).padEnd(39)}║
║  Discovery:   GET  /mcp/tools                         ║
║  Invoke:      POST /mcp/call                          ║
╚══════════════════════════════════════════════════════╝
  `);
});

export { app };
