#!/bin/bash
# initialize.sh — Helper script for NanoClaw agent to create projects
PROJECT_NAME=$1
TASK_DESC=$2

if [ -z "$PROJECT_NAME" ]; then
  echo "Usage: ./initialize.sh <project-name> <task-description>"
  exit 1
fi

echo "Initializing project: $PROJECT_NAME..."
# Use absolute paths safe for container
npx -y tsx /workspace/business_os/System/cli_runner.ts --task "$TASK_DESC" --project "$PROJECT_NAME" --auto-approve
