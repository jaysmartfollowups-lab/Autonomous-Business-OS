# MISSION CONTROL — Autonomous Business OS

## Agent Roles (Non-Negotiable)

### 🏗️ Google Antigravity — The Architect (CEO Layer)
- **Engine:** Gemini (1M+ token context)
- **Owns:** All frontend builds (React/Next.js), orchestration, task planning
- **Reads:** TASK.md handoff files from NanoClaw, Obsidian vault for context
- **Does NOT:** Scrape websites, execute untrusted backend code, author Skills

### ⚡ NanoClaw — The Operator (COO Layer)
- **Engine:** Claude 3.5 Sonnet/Haiku (TypeScript native)
- **Owns:** Secure sandboxed execution, web scraping, API interactions, distribution
- **Runs in:** Isolated Docker containers (dies on failure, no host impact)
- **Does NOT:** Manage the visual IDE, approve budgets, modify core files without approval

### 👤 Human Operator — The Governor (Approval Layer)
- **Approves:** All irreversible actions, budgets, public-facing content
- **Reviews:** Artifact checklists, build outputs, A/B test results
- **Channels:** Dashboard, WhatsApp/Telegram (future)

## Communication Flow

```
Human → Antigravity → NanoClaw → [Docker Container] → Output
                 ↑                        |
                 └── task_state.json ──────┘
```

## Autonomy Rules
| Action | NanoClaw Unattended? | Needs Approval? |
|--------|---------------------|-----------------|
| Research / pull data | ✅ Yes | No |
| Write to /Memory/learnings/ | ✅ Yes | No |
| Dry-run connectors | ✅ Yes | No |
| Execute connectors (sandbox=true) | ✅ Yes | No |
| Execute connectors (sandbox=false) | ❌ No | **Yes** |
| Post to social media | ❌ No | **Yes** |
| Send emails / spend money | ❌ No | **Yes** |
| Modify /Instructions/ or /System/ | ❌ No | **Yes** |
| Delete any file | ❌ No | **Yes** |

## System Invariants
1. Every connector MUST have `sandbox=true` as default
2. Every state transition MUST be logged in `task_state.json.history`
3. Every container MUST auto-remove on exit (`--rm`)
4. Secrets NEVER appear in code — always injected via environment variables
5. NanoClaw's write access is limited to `/Projects/` and `/Memory/learnings/`
