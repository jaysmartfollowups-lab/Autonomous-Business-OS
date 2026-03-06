import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// Define the root and relative directories
const ROOT_DIR = path.resolve(__dirname, '../..');
const BUSINESS_OS_DIR = path.join(ROOT_DIR, 'business_os');
const DASHBOARD_DIR = path.join(BUSINESS_OS_DIR, 'dashboard');

// Colors for terminal logs
const colors = {
    reset: "\x1b[0m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    green: "\x1b[32m",
    yellow: "\x1b[33m"
};

const processes: ChildProcess[] = [];

// Helper to spawn and prefix logs
function runService(name: string, dir: string, command: string, args: string[], color: string) {
    const proc = spawn(command, args, { cwd: dir, shell: true });
    processes.push(proc);

    const prefix = `${color}[${name}]${colors.reset} `;

    proc.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) console.log(`${prefix}${line}`);
        }
    });

    proc.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) console.error(`${prefix}${line}`);
        }
    });

    proc.on('close', (code) => {
        console.log(`${prefix}Process exited with code ${code}`);
        if (code !== 0 && !shuttingDown) {
            console.log(`\n❌ [SYSTEM] A critical service (${name}) failed. Shutting down all processes...`);
            shutdown();
        }
    });

    return proc;
}

let shuttingDown = false;
function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[SYSTEM] Received shutdown signal. Gracefully closing all systems...`);
    for (const proc of processes) {
        if (!proc.killed) {
            proc.kill('SIGINT');
        }
    }
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`
=======================================================
  🚀 Starting Autonomous Business OS (Phase 5)
=======================================================
[System] Booting local services + WSL integration...
`);

// 1. Dashboard (Next.js)
runService('DASHBOARD', DASHBOARD_DIR, 'npm', ['run', 'dev'], colors.blue);

// 2. Bridge (Express + WS)
runService('BRIDGE', BUSINESS_OS_DIR, 'npx', ['tsx', 'System/bridge.ts'], colors.magenta);

// 3. MCP Server
runService('MCP', BUSINESS_OS_DIR, 'npx', ['tsx', 'System/mcp_server.ts'], colors.green);

// 4. NanoClaw (WSL Docker Sandbox)
runService('NANOCLAW', ROOT_DIR, 'wsl', ['-d', 'Ubuntu-24.04', '-u', 'root', '--cd', '/root/NanoClaw', 'npm', 'run', 'dev'], colors.yellow);

// 5. Obsidian Markdown Sync (SQLite -> Obsidian .md files)
runService('OBSIDIAN', BUSINESS_OS_DIR, 'npx', ['tsx', 'System/obsidian_sync.ts'], colors.green);
