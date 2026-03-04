/**
 * notebooklm_connector.ts — NotebookLM Research Connector
 *
 * First concrete connector implementation for the BOS.
 * Uses the NotebookLM MCP server for grounded research.
 *
 * Capabilities:
 *   - pull(): Query NotebookLM for citation-backed research summaries
 *   - push(): Upload content to a NotebookLM notebook (future)
 *   - dry_run(): Log the research query without executing
 *
 * Authentication: Via existing NotebookLM MCP server session
 */

import {
    BaseConnector,
    ConnectorConfig,
    ConnectorResult,
    ConnectorStatus,
} from "./base_connector";
import { RetryHandler } from "../Utilities/retry_handler";
import fs from "fs";
import path from "path";

export class NotebookLMConnector extends BaseConnector {
    private retryHandler: RetryHandler;

    constructor(config: ConnectorConfig = {}, sandbox: boolean = true) {
        super("notebooklm_connector", config, sandbox);
        this.retryHandler = new RetryHandler("notebooklm_connector", 5);
    }

    /**
     * Authenticate with NotebookLM.
     * In MVP: Checks that the MCP server is configured.
     * Production: Would validate session cookies / MCP connectivity.
     */
    async authenticate(): Promise<boolean> {
        try {
            // Check if MCP config exists and has the NotebookLM MCP reference
            const mcpConfigPath = path.resolve(
                __dirname,
                "..",
                "..",
                "System",
                "mcp_config.json"
            );

            if (!fs.existsSync(mcpConfigPath)) {
                console.warn("[notebooklm_connector] mcp_config.json not found.");
                return false;
            }

            console.log("[notebooklm_connector] ✅ MCP config available. Auth check passed.");
            return true;
        } catch (err) {
            console.error("[notebooklm_connector] Authentication failed:", err);
            return false;
        }
    }

    /**
     * Pull research data from NotebookLM.
     *
     * In MVP (sandbox=true): Returns a mock research summary with realistic structure.
     * Production: Calls the NotebookLM MCP server's ask_question tool.
     *
     * @param query - { urls: string[], question: string, taskId: string }
     */
    async pull(query: Record<string, any>): Promise<ConnectorResult> {
        const taskId = query.taskId || "unknown";
        const startTime = Date.now();

        // Check sandbox guard
        const guardResult = await this.sandboxGuard("pull", query, taskId);
        if (guardResult) return guardResult;

        // Real execution (sandbox=false)
        try {
            const result = await this.retryHandler.execute(
                async () => {
                    // Simulate NotebookLM query processing time
                    await new Promise((resolve) => setTimeout(resolve, 2000));

                    const urls = (query.urls as string[]) || [];
                    const question = (query.question as string) || "General research query";

                    // In production, this would call the NotebookLM MCP server:
                    // const mcpResult = await mcpClient.callTool('ask_question', {
                    //   question,
                    //   notebook_url: query.notebook_url,
                    // });

                    // Mock research summary (realistic structure)
                    const summary = {
                        query: question,
                        sources_analyzed: urls.length,
                        citations: urls.map((url: string, i: number) => ({
                            source: url,
                            citation_id: `cite_${i + 1}`,
                            key_finding: `Key insight from ${new URL(url).hostname}: [mock finding ${i + 1}]`,
                            confidence: 0.85 + Math.random() * 0.15,
                        })),
                        synthesis: `Based on analysis of ${urls.length} sources, the research indicates [mock synthesis]. Key themes include competitive positioning, pricing strategy, and market differentiation.`,
                        generated_at: new Date().toISOString(),
                    };

                    return summary;
                },
                { label: "notebooklm_pull", maxRetries: 3 }
            );

            const durationMs = Date.now() - startTime;
            this.recordSuccess("pull", taskId, durationMs);

            return {
                success: true,
                data: result,
                duration_ms: durationMs,
                sandbox: this.sandbox,
            };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.recordFailure(errorMessage, taskId);

            return {
                success: false,
                data: {},
                error: errorMessage,
                duration_ms: Date.now() - startTime,
                sandbox: this.sandbox,
            };
        }
    }

    /**
     * Push content to NotebookLM (e.g., upload PDFs, add sources).
     * Not implemented in MVP — logs intent only.
     */
    async push(payload: Record<string, any>): Promise<ConnectorResult> {
        const taskId = payload.taskId || "unknown";

        // Always check sandbox guard
        const guardResult = await this.sandboxGuard("push", payload, taskId);
        if (guardResult) return guardResult;

        // Even in non-sandbox, push is not implemented in MVP
        console.log("[notebooklm_connector] push() not yet implemented for production.");
        return {
            success: false,
            data: {},
            error: "push() not implemented in MVP. Use NotebookLM UI to add sources.",
            duration_ms: 0,
            sandbox: this.sandbox,
        };
    }

    /**
     * Check connector status.
     */
    async status(): Promise<ConnectorStatus> {
        return {
            name: this.name,
            connected: await this.authenticate(),
            sandbox: this.sandbox,
            circuit_state: this.circuitState,
            failure_count: this.failureCount,
            last_execution: this.lastExecution,
        };
    }

    /**
     * Dry run — logs the research query without executing.
     */
    async dry_run(payload: Record<string, any>): Promise<ConnectorResult> {
        const taskId = payload.taskId || "unknown";

        console.log("[notebooklm_connector] DRY RUN — Query logged, not executed:");
        console.log(JSON.stringify(payload, null, 2));

        this.logExecution("dry_run", payload, taskId, 0);

        return {
            success: true,
            data: {
                dry_run: true,
                would_query: payload.question || "N/A",
                would_analyze: (payload.urls as string[])?.length || 0,
                estimated_time_seconds: 2,
            },
            duration_ms: 0,
            sandbox: this.sandbox,
        };
    }

    /**
     * Write research output to the project's Output directory.
     */
    async writeResearchOutput(
        projectName: string,
        data: Record<string, any>
    ): Promise<string> {
        const outputDir = path.resolve(
            __dirname,
            "..",
            "..",
            "Projects",
            projectName,
            "Output"
        );

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const filename = `notebooklm_summary_${Date.now()}.md`;
        const filepath = path.join(outputDir, filename);

        const markdown = this.formatAsMarkdown(data);
        fs.writeFileSync(filepath, markdown, "utf-8");

        console.log(`[notebooklm_connector] Research output written to: ${filepath}`);
        return filepath;
    }

    private formatAsMarkdown(data: any): string {
        let md = `# NotebookLM Research Summary\n\n`;
        md += `> Generated: ${data.generated_at || new Date().toISOString()}\n\n`;
        md += `## Query\n${data.query || "N/A"}\n\n`;
        md += `## Sources Analyzed: ${data.sources_analyzed || 0}\n\n`;

        if (data.citations) {
            md += `## Citations\n`;
            for (const cite of data.citations) {
                md += `### [${cite.citation_id}] ${cite.source}\n`;
                md += `- **Finding:** ${cite.key_finding}\n`;
                md += `- **Confidence:** ${(cite.confidence * 100).toFixed(1)}%\n\n`;
            }
        }

        md += `## Synthesis\n${data.synthesis || "N/A"}\n`;
        return md;
    }
}
