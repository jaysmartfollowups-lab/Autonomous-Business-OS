# Autonomous Business OS: Native Linux VPS Deployment SOP

## Overview
This document serves as the step-by-step Standard Operating Procedure (SOP) for Antigravity to deploy the entire Business OS and NanoClaw stack to a pristine Linux VPS (Hetzner Cloud - Ubuntu 24.04). 

**Do NOT begin execution until the USER provides the Server IP and Root Password.**

---

## Phase 1: Authentication & Connection
1. **Receive Credentials:** Wait for the user to provide the server IP address and root password.
2. **Establish SSH Connection:** Use the Windows terminal's native SSH client to log into the remote server.
   *Command:* `ssh root@[SERVER_IP]`
3. **Change Default Password (Security):** If prompted or necessary, update the root password and enforce basic security (optional for testing, but highly recommended).

## Phase 2: System Provisioning
Run an automated installation script to prep the bare-metal Linux environment:
1. **Update System Packages:** `apt update && apt upgrade -y`
2. **Install Core Dependencies:** `apt install -y curl git wget build-essential`
3. **Install Node.js & TypeScript:** 
   * Install Node.js v20+ via NodeSource.
   * Install standard global packages: `npm install -g typescript tsx pm2` (PM2 is used to keep our processes alive 24/7).
4. **Install Docker Natively:** `apt install -y docker.io docker-compose-v2`
   * Verify native Docker runs without the WSL hypervisor overhead.

## Phase 3: Codebase Deployment
1. **Clone the Repositories:** Pull the exact system state that we pushed to GitHub today.
   * `git clone https://github.com/jaysmartfollowups-lab/Autonomous-Business-OS.git business_os`
   * `git clone https://github.com/jaysmartfollowups-lab/NanoClaw.git NanoClaw`
2. **Install Project Dependencies:**
   * Run `npm install` in the `business_os` root.
   * Run `npm install` inside the `dashboard` directory.
   * Run `npm install` in the `NanoClaw` root.
3. **Configure Environment Variables:** Recreate the `.env` and `credentials.json` files securely on the server.

## Phase 4: Adapting for Native Linux (Removing WSL Hacks)
Before starting the system, mathematically strip out all the "glue" code that was forcing Windows and WSL to communicate. 

1. **Refactor SQLite Dispatch:**
   * **Target:** `business_os/System/mcp_server.ts` and `business_os/System/test_mcp_bridge.ts`
   * **Action:** Delete the custom `spawn('/usr/bin/sqlite3')` workaround. Replace it with direct database writes using the native `better-sqlite3` Node module, as both systems now share the same `ext4` filesystem.
2. **Unify File Paths:**
   * **Action:** Remove any logic translating `C:\Users\...` to `/root/NanoClaw/...`. Hardcode or dynamically resolve native POSIX paths (`/root/business_os/Projects/...`).
3. **Remove Docker Timeouts:**
   * **Target:** `NanoClaw/src/container-runtime.ts`
   * **Action:** Restore the `docker info` health check timeout from 30 seconds down to a tighter, standard tolerance (e.g., 5 seconds) since Linux allocates Docker runtime resources natively without hypervisor starvation.

## Phase 5: System Ignition & Verification
1. **Start the Dashboard:** Run `npm run build && pm2 start npm --name "dashboard" -- start` inside the Next.js directory.
2. **Start the MCP Server:** Run `pm2 start mcp_server.ts --interpreter tsx`
3. **Start the Orchestration Bridge:** Run `pm2 start bridge.ts --interpreter tsx`
4. **Boot NanoClaw:** Run `pm2 start npm --name "nanoclaw" -- start` in the worker directory.
5. **Save State:** Run `pm2 save` so the OS automatically reboots the entire stack if the physical server restarts.
6. **Final Verification test:** Run `npx tsx System/test_mcp_bridge.ts` completely natively on the server and monitor the output to confirm lightning-fast state transitions and Docker sandboxing.

---
**Status Status:** WAITING FOR CREDENTIALS
