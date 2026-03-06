import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const ROOT_DIR = path.resolve(__dirname, '../..');
const BUSINESS_OS_DIR = path.join(ROOT_DIR, 'business_os');
const DB_PATH = path.join(BUSINESS_OS_DIR, 'Memory', 'local_state.sqlite');
const SCRIPT_PATH = path.join(BUSINESS_OS_DIR, 'execution', 'sqlite_to_md.py');

let isRunning = false;
let pendingRun = false;

function runSync() {
    if (isRunning) {
        pendingRun = true;
        return;
    }

    isRunning = true;
    console.log(`[OBSIDIAN_SYNC] Triggering SQLite -> Markdown export...`);

    const proc = spawn('python', [SCRIPT_PATH], { stdio: 'pipe' });

    proc.on('close', (code) => {
        isRunning = false;
        if (code === 0) {
            console.log(`[OBSIDIAN_SYNC] Export complete.`);
        } else {
            console.error(`[OBSIDIAN_SYNC] Export failed with code ${code}.`);
        }

        if (pendingRun) {
            pendingRun = false;
            runSync();
        }
    });
}

// Initial run
runSync();

// Watch the database for changes
if (fs.existsSync(DB_PATH)) {
    console.log(`[OBSIDIAN_SYNC] Watching ${DB_PATH} for changes...`);
    fs.watch(DB_PATH, (eventType, filename) => {
        if (eventType === 'change') {
            // Debounce the run
            setTimeout(() => {
                runSync();
            }, 1000);
        }
    });
} else {
    console.log(`[OBSIDIAN_SYNC] Waiting for database to be created at ${DB_PATH}...`);

    // Fallback polling if DB doesn't exist yet
    const checkInterval = setInterval(() => {
        if (fs.existsSync(DB_PATH)) {
            clearInterval(checkInterval);
            console.log(`[OBSIDIAN_SYNC] Database found! Watching ${DB_PATH} for changes...`);
            fs.watch(DB_PATH, (eventType, filename) => {
                if (eventType === 'change') {
                    // Debounce the run
                    setTimeout(() => {
                        runSync();
                    }, 1000);
                }
            });
            runSync();
        }
    }, 5000);
}

// Keep the process alive
setInterval(() => { }, 1000 * 60 * 60);
