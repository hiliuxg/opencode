#!/bin/bash

# Configuration
API_URL="http://localhost:8787/api"
USER_ID="leoliu"

echo "---------------------------------------------------"
echo "Testing workspace_dir Filtering"
echo "---------------------------------------------------"

# 1. Create Job in Workspace 1
echo "Creating Job 1 in /tmp/ws1..."
JOB1_ID=$(curl -s -X POST "$API_URL/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "'"$USER_ID"'",
    "name": "Job in WS1",
    "cronExpression": "0 0 * * *",
    "workspaceDir": "/tmp/ws1",
    "prompt": "Test Prompt 1"
  }' | jq -r '.item.id')
echo "Job 1 ID: $JOB1_ID"

# 2. Create Job in Workspace 2
echo "Creating Job 2 in /tmp/ws2..."
JOB2_ID=$(curl -s -X POST "$API_URL/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "'"$USER_ID"'",
    "name": "Job in WS2",
    "cronExpression": "0 0 * * *",
    "workspaceDir": "/tmp/ws2",
    "prompt": "Test Prompt 2"
  }' | jq -r '.item.id')
echo "Job 2 ID: $JOB2_ID"

# 3. Filter Jobs by Workspace
echo ""
echo "Filtering Jobs by /tmp/ws1:"
curl -s "$API_URL/jobs?workspaceDir=/tmp/ws1" | jq -c '.items[] | {id, name, workspaceDir}'

echo "Filtering Jobs by /tmp/ws2:"
curl -s "$API_URL/jobs?workspaceDir=/tmp/ws2" | jq -c '.items[] | {id, name, workspaceDir}'

# 4. Trigger Execution for Job 1
echo ""
echo "Triggering Job 1..."
curl -s -X POST "$API_URL/jobs/$JOB1_ID/run" | jq -r '.message'
sleep 1 # Wait for execution to be created

# 5. Filter Executions by Workspace
echo ""
echo "Filtering Executions by /tmp/ws1 (Should see execution):"
curl -s "$API_URL/executions?workspaceDir=/tmp/ws1" | jq -c '.items[] | {id, jobId, status}'

echo "Filtering Executions by /tmp/ws2 (Should catch nothing):"
curl -s "$API_URL/executions?workspaceDir=/tmp/ws2" | jq -c '.items[] | {id, jobId, status}'

# 6. Cleanup
echo ""
echo "Cleaning up..."
curl -s -X DELETE "$API_URL/jobs/$JOB1_ID" > /dev/null
curl -s -X DELETE "$API_URL/jobs/$JOB2_ID" > /dev/null
echo "Done."
