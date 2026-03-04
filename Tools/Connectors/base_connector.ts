/**
 * BaseConnector — Abstract Foundation for All NanoClaw Connectors
 *
 * Every TypeScript connector that NanoClaw uses must extend this class.
 * The sandbox flag is MANDATORY and defaults to true.
 *
 * When sandbox=true:
 *   - push() logs the payload but does NOT execute
 *   - dry_run() always logs without executing
 *   - All actions are recorded in the container_logs SQLite table
 *
 * When sandbox=false (requires human approval):
 *   - push() executes the real action
 *   - All actions are still logged for audit trail
 */

import Database from "better-sqlite3";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export interface ConnectorConfig {
    [key: string]: any;
}

export interface ConnectorResult {
    success: boolean;
    data: Record<string, any>;
    error?: string;
    duration_ms: number;
    sandbox: boolean;
}

export interface ConnectorStatus {
    name: string;
    connected: boolean;
    sandbox: boolean;
    circuit_state: "CLOSED" | "OPEN";
    failure_count: number;
    last_execution?: string;
}

export abstract class BaseConnector {
    protected name: string;
    protected config: ConnectorConfig;
    protected sandbox: boolean;
    protected failureCount: number = 0;
    protected maxFailures: number = 5;
    protected circuitState: "CLOSED" | "OPEN" = "CLOSED";
    protected lastExecution?: string;

    constructor(name: string, config: ConnectorConfig, sandbox: boolean = true) {
        this.name = name;
        this.config = config;
        this.sandbox = sandbox;
    }

    // --- Abstract methods (every connector MUST implement) ---

    /** Authenticate with the external service */
    abstract authenticate(): Promise<boolean>;

    /** Push data to the external service (e.g., post content, send email) */
    abstract push(payload: Record<string, any>): Promise<ConnectorResult>;

    /** Pull data from the external service (e.g., fetch research, get analytics) */
    abstract pull(query: Record<string, any>): Promise<ConnectorResult>;

    /** Check the connection status of the external service */
    abstract status(): Promise<ConnectorStatus>;

    /** Simulate the action without executing — logs intent only */
    abstract dry_run(payload: Record<string, any>): Promise<ConnectorResult>;

    // --- Protected utility methods ---

    /**
     * Log an execution event to the SQLite container_logs table.
     * Called automatically by sandbox-enforced methods.
     */
    protected logExecution(
        action: string,
        payload: any,
        taskId: string = "unknown",
        exitCode: number = 0,
        errorLog?: string,
        durationMs: number = 0
    ): void {
        try {
            const dbPath = path.resolve(__dirname, "..", "..", "Memory", "local_state.sqlite");
            const db = new Database(dbPath);
            db.pragma("journal_mode = WAL");

            const stmt = db.prepare(`
        INSERT INTO container_logs (task_id, container_id, connector, action, exit_code, duration_ms, error_log, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

            stmt.run(
                taskId,
                process.env.CONTAINER_ID || `local-${uuidv4().slice(0, 8)}`,
                this.name,
                action,
                exitCode,
                durationMs,
                errorLog || null,
                JSON.stringify({ sandbox: this.sandbox, payload_preview: this.truncatePayload(payload) })
            );

            db.close();
        } catch (err) {
            // Log to console if DB write fails — never crash the connector
            console.error(`[${this.name}] Failed to log execution:`, err);
        }
    }

    /**
     * Enforce sandbox rules before push().
     * When sandbox=true, logs the payload and returns without executing.
     */
    protected async sandboxGuard(
        action: string,
        payload: Record<string, any>,
        taskId: string
    ): Promise<ConnectorResult | null> {
        if (this.circuitState === "OPEN") {
            const result: ConnectorResult = {
                success: false,
                data: {},
                error: `CIRCUIT_OPEN: ${this.name} has failed ${this.failureCount} times. Circuit breaker is OPEN.`,
                duration_ms: 0,
                sandbox: this.sandbox,
            };
            this.logExecution(action, payload, taskId, 1, result.error);
            return result;
        }

        if (this.sandbox) {
            console.log(`[${this.name}] SANDBOX MODE — ${action} logged, not executed.`);
            console.log(`[${this.name}] Payload:`, JSON.stringify(payload, null, 2));
            this.logExecution(action, payload, taskId, 0);
            return {
                success: true,
                data: { sandbox: true, action, logged: true },
                duration_ms: 0,
                sandbox: true,
            };
        }

        return null; // Proceed with real execution
    }

    /**
     * Record a failure. If failure count exceeds maxFailures, trip the circuit breaker.
     */
    protected recordFailure(error: string, taskId: string): void {
        this.failureCount++;
        if (this.failureCount >= this.maxFailures) {
            this.circuitState = "OPEN";
            console.error(
                `[${this.name}] CIRCUIT BREAKER OPEN — ${this.failureCount} failures reached.`
            );
        }
        this.logExecution("failure", { error }, taskId, 1, error);
    }

    /**
     * Record a successful execution. Resets failure count.
     */
    protected recordSuccess(action: string, taskId: string, durationMs: number): void {
        this.failureCount = 0;
        this.lastExecution = new Date().toISOString();
        this.logExecution(action, {}, taskId, 0, undefined, durationMs);
    }

    /**
     * Truncate large payloads for logging (prevents DB bloat).
     */
    private truncatePayload(payload: any): string {
        const str = JSON.stringify(payload);
        if (str.length > 500) {
            return str.slice(0, 500) + "... [truncated]";
        }
        return str;
    }
}
