import sqlite3
import os
import json
from datetime import datetime

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "Memory", "local_state.sqlite")
LOGS_DIR = os.path.join(BASE_DIR, "human_brain", "activity_logs")
CONTEXT_DIR = os.path.join(BASE_DIR, "human_brain", "ai_context")

def ensure_dirs():
    os.makedirs(LOGS_DIR, exist_ok=True)
    os.makedirs(CONTEXT_DIR, exist_ok=True)

def export_state_transitions(cursor):
    cursor.execute("SELECT id, timestamp, task_id, from_status, to_status, actor, reason FROM state_transitions ORDER BY timestamp DESC")
    transitions = cursor.fetchall()
    
    if not transitions:
        return

    # Group by task_id and date
    tasks = {}
    for t in transitions:
        t_id, ts, task_id, from_s, to_s, actor, reason = t
        date_str = ts.split(" ")[0] if " " in ts else ts.split("T")[0]
        
        if task_id not in tasks:
            tasks[task_id] = []
        tasks[task_id].append(t)

    for task_id, trans in tasks.items():
        if not trans: continue
        
        # Determine latest date for this task to put in logs
        latest_date = trans[0][1].split(" ")[0] if " " in trans[0][1] else trans[0][1].split("T")[0]
        safe_task_id = task_id.replace("/", "_").replace("\\", "_")
        filename = f"{latest_date}_Task_{safe_task_id}_Transitions.md"
        filepath = os.path.join(LOGS_DIR, filename)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"---\n")
            f.write(f"type: state_transitions\n")
            f.write(f"task_id: {task_id}\n")
            f.write(f"last_updated: {trans[0][1]}\n")
            f.write(f"---\n\n")
            f.write(f"# State Transitions for Task: {task_id}\n\n")
            
            for t in trans:
                t_id, ts, task_id_val, from_s, to_s, actor, reason = t
                f.write(f"## [{ts}] {actor}\n")
                f.write(f"**{from_s}** ➔ **{to_s}**\n")
                if reason:
                    f.write(f"> {reason}\n")
                f.write(f"\n---\n\n")

def export_container_logs(cursor):
    cursor.execute("SELECT id, timestamp, task_id, container_id, connector, action, exit_code, duration_ms, error_log, metadata FROM container_logs ORDER BY timestamp DESC")
    logs = cursor.fetchall()
    
    if not logs:
        return
        
    for log in logs:
        l_id, ts, task_id, container_id, connector, action, exit_code, duration_ms, error_log, metadata = log
        date_str = ts.split(" ")[0] if " " in ts else ts.split("T")[0]
        safe_task_id = task_id.replace("/", "_").replace("\\", "_")
        filename = f"{date_str}_Action_{connector}_{safe_task_id}_{l_id}.md"
        filepath = os.path.join(LOGS_DIR, filename)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"---\n")
            f.write(f"type: container_log\n")
            f.write(f"task_id: {task_id}\n")
            f.write(f"connector: {connector}\n")
            f.write(f"action: {action}\n")
            f.write(f"exit_code: {exit_code}\n")
            f.write(f"duration_ms: {duration_ms}\n")
            f.write(f"timestamp: {ts}\n")
            f.write(f"---\n\n")
            
            f.write(f"# Container Execution: {connector} - {action}\n\n")
            f.write(f"- **Task ID:** {task_id}\n")
            f.write(f"- **Container ID:** {container_id or 'N/A'}\n")
            f.write(f"- **Status:** {'✅ Success' if exit_code == 0 else '❌ Failed'}\n")
            f.write(f"- **Duration:** {duration_ms} ms\n\n")
            
            if error_log:
                f.write(f"## Error Log\n```\n{error_log}\n```\n\n")
                
            try:
                if metadata and metadata != '{}':
                    meta_obj = json.loads(metadata)
                    f.write(f"## Metadata\n```json\n{json.dumps(meta_obj, indent=2)}\n```\n")
            except json.JSONDecodeError:
                f.write(f"## Metadata\n```\n{metadata}\n```\n")

def export_active_context(cursor):
    cursor.execute("SELECT id, timestamp, role, content, task_id, token_count FROM active_context ORDER BY timestamp ASC")
    contexts = cursor.fetchall()
    
    if not contexts:
        return
        
    # Group by task_id
    tasks = {}
    for c in contexts:
        c_id, ts, role, content, task_id, token_count = c
        if not task_id:
            task_id = "General_Context"
        if task_id not in tasks:
            tasks[task_id] = []
        tasks[task_id].append(c)
        
    for task_id, ctxs in tasks.items():
        if not ctxs: continue
        safe_task_id = task_id.replace("/", "_").replace("\\", "_")
        filename = f"Context_{safe_task_id}.md"
        filepath = os.path.join(CONTEXT_DIR, filename)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"---\n")
            f.write(f"type: active_context\n")
            f.write(f"task_id: {task_id}\n")
            f.write(f"messages_count: {len(ctxs)}\n")
            f.write(f"---\n\n")
            f.write(f"# Active Context: {task_id}\n\n")
            f.write(f"> This is a running log of the AI's short-term memory and context.\n\n")
            
            for c in ctxs:
                c_id, ts, role, content, task_id_val, token_count = c
                f.write(f"## {role.upper()} [{ts}] (Tokens: {token_count})\n\n")
                f.write(f"{content}\n\n")
                f.write(f"---\n\n")

def main():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    ensure_dirs()
    print(f"Connecting to database at {DB_PATH}")
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        print("Exporting state transitions...")
        export_state_transitions(cursor)
        
        print("Exporting container logs...")
        export_container_logs(cursor)
        
        print("Exporting active context...")
        export_active_context(cursor)
        
        print(f"Export complete. Check {LOGS_DIR} and {CONTEXT_DIR}.")
    except Exception as e:
        print(f"Error exporting database: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    main()
