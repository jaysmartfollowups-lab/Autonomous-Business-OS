# 🧠 Autonomous Business OS - Obsidian Vault

Welcome to your Unified AI Brain. This project is structured to separate Human thoughts from AI Agent execution logic ("Church and State" architecture).

## 📂 Vault Structure

### 👤 Human Brain (`/human_brain`)
*   **activity_logs/**: Automated logs of every state transition and action NanoClaw takes.
*   **ai_context/**: The "Long Term Memory" and MISSION_CONTROL for your agents.
*   **daily_notes/**: Your personal workspace for daily planning.
*   **projects/**: High-level business projects and roadmap.
*   **vision_journal/**: Long-term goals and strategy.

### 🤖 AI Brain (`/ai_brain`)
*   **directives/**: The deterministic SOPs (Standard Operating Procedures) that NanoClaw follows.
*   **skills/**: The modular "Capabilities" NanoClaw can use (e.g., Python scripts, API connectors).
*   **workflows/**: Complex, multi-step agent behaviors.
*   **research_results/**: Raw outputs from AI research tasks.

## ⚡ Live Interaction
The system is equipped with **Live Markdown Sync**. Whenever the SQLite database updates (execution metrics, logs, context), the files in `human_brain/` are automatically regenerated.

> [!TIP]
> Use Obsidian's **Graph View** to see how your Directives connect to your Activity Logs!

## 🛠️ System Core (`/System`, `/execution`, `/Tools`)
These folders contain the technical implementation, environment variables, and Docker sandbox integration. Usually, you don't need to edit these in Obsidian.
