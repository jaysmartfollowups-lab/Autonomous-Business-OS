// test_mcp_bridge.ts

async function main() {
    console.log("Starting MCP Bridge Test...");

    const payload = {
        tool: "trigger_nanoclaw_sandbox",
        input: {
            task_id: `mcp_test_${Date.now()}`,
            connector_name: "notebooklm_connector",
            action: "pull",
            sandbox: true,
            payload: {
                urls: ["https://example.com"],
                question: "Bridge test"
            }
        }
    };

    try {
        const res = await fetch("http://localhost:3002/mcp/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            console.error(`Status: ${res.status}`);
            console.log(await res.text());
            return;
        }

        const json: any = await res.json();
        console.log("MCP Response:", JSON.stringify(json, null, 2));

        if (json.result?.status === "completed") {
            console.log("✅ Bridge test successful");
        } else {
            console.log("❌ Bridge test failed in result content");
        }
    } catch (err) {
        console.error("❌ Bridge test caught failure:", err);
    }
}

main().catch(console.error);
