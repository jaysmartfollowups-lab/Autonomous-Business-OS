/**
 * bridge.ts — Backend Bridge Server
 *
 * Express.js server + WebSocket for real-time communication between
 * NanoClaw containers, the dashboard, and the MCP server.
 *
 * Port 3001:
 *   REST endpoints: /api/tasks, /api/projects, /api/system
 *   WebSocket: ws://localhost:3001 (live container log streaming)
 *
 * Features:
 *   - Tails container_logs SQLite table and pushes new rows via WebSocket
 *   - Serves task_state.json for each project
 *   - System health and status endpoint
 */

import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { TaskStateManager, TASK_STATUSES, type TaskStatus } from "./task_state";

const PORT = parseInt(process.env.BRIDGE_PORT || "3001", 10);
const ROOT_DIR = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT_DIR, "Memory", "local_state.sqlite");
const PROJECTS_DIR = path.join(ROOT_DIR, "Projects");

// === Express App ===
const app = express();
app.use(express.json());

// CORS for dashboard (runs on port 3000)
app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});

// === Helper: Get DB Connection ===
function getDb(): Database.Database {
    const db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
    return db;
}

// === REST Endpoints ===

/**
 * GET /api/health — System health check
 */
app.get("/api/health", (_req, res) => {
    const dbExists = fs.existsSync(DB_PATH);
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        database: dbExists ? "connected" : "missing",
        bridge_port: PORT,
    });
});

/**
 * GET /api/projects — List all projects with their task states
 */
app.get("/api/projects", (_req, res) => {
    try {
        const projects: any[] = [];

        if (!fs.existsSync(PROJECTS_DIR)) {
            res.json({ projects: [] });
            return;
        }

        const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });

        for (const dir of dirs) {
            if (!dir.isDirectory() || dir.name.startsWith("_")) continue;

            const taskStatePath = path.join(PROJECTS_DIR, dir.name, "task_state.json");

            if (fs.existsSync(taskStatePath)) {
                try {
                    const state = JSON.parse(fs.readFileSync(taskStatePath, "utf-8"));
                    projects.push({
                        name: dir.name,
                        ...state,
                    });
                } catch {
                    projects.push({ name: dir.name, status: "UNKNOWN", error: "Invalid task_state.json" });
                }
            } else {
                projects.push({ name: dir.name, status: "NO_STATE" });
            }
        }

        res.json({ projects, total: projects.length });
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/projects/:name — Get a specific project's task state
 */
app.get("/api/projects/:name", (req, res) => {
    try {
        const stateManager = new TaskStateManager(ROOT_DIR);
        const state = stateManager.load(req.params.name);
        res.json(state);
    } catch (err) {
        res.status(404).json({ error: String(err) });
    }
});

/**
 * POST /api/projects/:name/transition — Transition a task's state
 * Body: { status: "APPROVED", actor: "human", reason?: "Looks good" }
 */
app.post("/api/projects/:name/transition", (req, res) => {
    try {
        const { status, actor, reason } = req.body;

        if (!status || !actor) {
            res.status(400).json({ error: "Missing required fields: status, actor" });
            return;
        }

        if (!TASK_STATUSES.includes(status)) {
            res.status(400).json({ error: `Invalid status: ${status}. Valid: ${TASK_STATUSES.join(", ")}` });
            return;
        }

        const stateManager = new TaskStateManager(ROOT_DIR);
        const updated = stateManager.transition(req.params.name, status as TaskStatus, actor, reason);

        // Broadcast state change via WebSocket
        broadcastWs({
            type: "state_change",
            task_id: updated.task_id,
            container_id: null,
            timestamp: new Date().toISOString(),
            level: "INFO",
            message: `${updated.task_id}: → ${status} (by ${actor})`,
            metadata: { project: req.params.name, from: req.body.from, to: status },
        });

        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: String(err) });
    }
});

/**
 * GET /api/logs — Get recent container logs
 * Query: ?limit=50&task_id=xxx
 */
app.get("/api/logs", (req, res) => {
    try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const taskId = req.query.task_id as string;

        let query = "SELECT * FROM container_logs ORDER BY id DESC LIMIT ?";
        let params: any[] = [limit];

        if (taskId) {
            query = "SELECT * FROM container_logs WHERE task_id = ? ORDER BY id DESC LIMIT ?";
            params = [taskId, limit];
        }

        const logs = db.prepare(query).all(...params);
        db.close();

        res.json({ logs, total: logs.length });
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/transitions — Get state transition history
 * Query: ?limit=50&task_id=xxx
 */
app.get("/api/transitions", (req, res) => {
    try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const taskId = req.query.task_id as string;

        let query = "SELECT * FROM state_transitions ORDER BY id DESC LIMIT ?";
        let params: any[] = [limit];

        if (taskId) {
            query = "SELECT * FROM state_transitions WHERE task_id = ? ORDER BY id DESC LIMIT ?";
            params = [taskId, limit];
        }

        const transitions = db.prepare(query).all(...params);
        db.close();

        res.json({ transitions, total: transitions.length });
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/approvals — Get tasks awaiting human approval
 */
app.get("/api/approvals", (_req, res) => {
    try {
        const projects: any[] = [];

        if (!fs.existsSync(PROJECTS_DIR)) {
            res.json({ approvals: [] });
            return;
        }

        const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });

        for (const dir of dirs) {
            if (!dir.isDirectory() || dir.name.startsWith("_")) continue;

            const taskStatePath = path.join(PROJECTS_DIR, dir.name, "task_state.json");
            if (!fs.existsSync(taskStatePath)) continue;

            try {
                const state = JSON.parse(fs.readFileSync(taskStatePath, "utf-8"));
                if (
                    state.status === "AWAITING_HUMAN_APPROVAL" ||
                    state.status === "AWAITING_REVIEW"
                ) {
                    projects.push({ project: dir.name, ...state });
                }
            } catch {
                // Skip invalid files
            }
        }

        res.json({ approvals: projects, total: projects.length });
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/system — System overview
 */
app.get("/api/system", (_req, res) => {
    try {
        const dbExists = fs.existsSync(DB_PATH);
        let logCount = 0;
        let transitionCount = 0;

        if (dbExists) {
            const db = getDb();
            logCount = (db.prepare("SELECT COUNT(*) as count FROM container_logs").get() as any)?.count || 0;
            transitionCount = (db.prepare("SELECT COUNT(*) as count FROM state_transitions").get() as any)?.count || 0;
            db.close();
        }

        // Count projects
        let projectCount = 0;
        if (fs.existsSync(PROJECTS_DIR)) {
            projectCount = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
                .filter((d) => d.isDirectory() && !d.name.startsWith("_")).length;
        }

        res.json({
            database: dbExists ? "connected" : "missing",
            container_logs: logCount,
            state_transitions: transitionCount,
            active_projects: projectCount,
            bridge_port: PORT,
            uptime_seconds: Math.floor(process.uptime()),
        });
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

// === HTTP + WebSocket Server ===
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients: Set<WebSocket> = new Set();

wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`[bridge] WebSocket client connected. Total: ${clients.size}`);

    // Send welcome message
    ws.send(
        JSON.stringify({
            type: "alert",
            task_id: null,
            container_id: null,
            timestamp: new Date().toISOString(),
            level: "INFO",
            message: "Connected to BOS Bridge WebSocket",
            metadata: { clients: clients.size },
        })
    );

    ws.on("close", () => {
        clients.delete(ws);
        console.log(`[bridge] WebSocket client disconnected. Total: ${clients.size}`);
    });

    ws.on("error", (err) => {
        console.error("[bridge] WebSocket error:", err);
        clients.delete(ws);
    });
});

/**
 * Broadcast a message to all connected WebSocket clients.
 */
function broadcastWs(message: Record<string, any>): void {
    const payload = JSON.stringify(message);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

// === SQLite Log Tailing ===
let lastLogId = 0;

function initLastLogId(): void {
    try {
        if (!fs.existsSync(DB_PATH)) return;
        const db = getDb();
        const row = db.prepare("SELECT MAX(id) as maxId FROM container_logs").get() as any;
        lastLogId = row?.maxId || 0;
        db.close();
    } catch {
        lastLogId = 0;
    }
}

/**
 * Poll container_logs for new rows and push to WebSocket clients.
 * Runs every 2 seconds.
 */
function tailLogs(): void {
    try {
        if (!fs.existsSync(DB_PATH) || clients.size === 0) return;

        const db = getDb();
        const newLogs = db
            .prepare("SELECT * FROM container_logs WHERE id > ? ORDER BY id ASC LIMIT 50")
            .all(lastLogId) as any[];
        db.close();

        for (const log of newLogs) {
            broadcastWs({
                type: "container_log",
                task_id: log.task_id,
                container_id: log.container_id,
                timestamp: log.timestamp,
                level: log.exit_code === 0 ? "INFO" : "ERROR",
                message: log.error_log || `${log.connector}::${log.action} completed (exit: ${log.exit_code})`,
                metadata: {
                    connector: log.connector,
                    action: log.action,
                    duration_ms: log.duration_ms,
                    exit_code: log.exit_code,
                },
            });
            lastLogId = log.id;
        }
    } catch (err) {
        // Silently handle — don't crash the server
    }
}

// === Start Server ===
initLastLogId();
setInterval(tailLogs, 2000);

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║          BOS Bridge Server — Active                   ║
╠══════════════════════════════════════════════════════╣
║  REST API:    http://localhost:${String(PORT).padEnd(27)}║
║  WebSocket:   ws://localhost:${String(PORT).padEnd(28)}║
║  Endpoints:   /api/health, /api/projects,             ║
║               /api/logs, /api/approvals,              ║
║               /api/transitions, /api/system           ║
╚══════════════════════════════════════════════════════╝
  `);
});

export { app, server, broadcastWs };
