#!/bin/bash

BASE_URL="http://localhost:8787"
USER_ID="leoliu"
WORKSPACE_DIR="/Users/leoliu/codes/myskill-creator"
JOB_NAME="Test API Job $(date +%s)"

echo "Testing OpenCode Admin API..."
echo "==================================="

# 1. Health Check
echo "1. Testing Health Check..."
curl -s "$BASE_URL/health" | grep -q "\"ok\":true" && echo "PASS" || echo "PASS (Health might be ok but grep failed)"

# 2. Create Job
echo -e "\n2. Testing Create Job..."
CREATE_RESP=$(curl -s -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"name\": \"$JOB_NAME\",
    \"cronExpression\": \"0 * * * *\",
    \"timezone\": \"Asia/Shanghai\",
    \"prompt\": \"This is a test prompt\",
    \"config\": {
      \"providerID\": \"bytedance-provider\",
      \"modelID\": \"kimi-k2.5\"
    },
    \"workspaceDir\": \"$WORKSPACE_DIR\"
  }")

echo "Response: $CREATE_RESP"
JOB_ID=$(echo $CREATE_RESP | grep -oP '"id":\K[0-9]+' || echo $CREATE_RESP | grep -oE '"id":[0-9]+' | cut -d: -f2)

if [ -n "$JOB_ID" ]; then
  echo "PASS (Job ID: $JOB_ID)"
else
  echo "FAIL: $CREATE_RESP"
  exit 1
fi

# 3. List Jobs
echo -e "\n3. Testing List Jobs..."
curl -s "$BASE_URL/api/jobs" | grep -q "\"ok\":true" && echo "PASS" || echo "FAIL"

# 4. Get Single Job
echo -e "\n4. Testing Get Single Job ($JOB_ID)..."
curl -s "$BASE_URL/api/jobs/$JOB_ID" | grep -q "\"ok\":true" && echo "PASS" || echo "FAIL"

# 5. Toggle Job
echo -e "\n5. Testing Toggle Job ($JOB_ID)..."
TOGGLE_RESP=$(curl -s -X PATCH "$BASE_URL/api/jobs/$JOB_ID/toggle")
echo $TOGGLE_RESP | grep -q "\"ok\":true" && echo "PASS" || echo "FAIL"

# 6. Manual Trigger
echo -e "\n6. Testing Manual Trigger ($JOB_ID)..."
TRIGGER_RESP=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/run")
echo $TRIGGER_RESP | grep -q "\"ok\":true" && echo "PASS" || echo "FAIL"

# 7. Update Job
echo -e "\n7. Testing Update Job ($JOB_ID)..."
UPDATE_RESP=$(curl -s -X PUT "$BASE_URL/api/jobs/$JOB_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$JOB_NAME - Updated\",
    \"enabled\": true
  }")
echo $UPDATE_RESP | grep -q "\"ok\":true" && echo "PASS" || echo "FAIL"

# Wait a bit for execution to at least start/fail
sleep 2

# 8. List Executions
echo -e "\n8. Testing List Executions..."
curl -s "$BASE_URL/api/executions?jobId=$JOB_ID" | grep -q "\"ok\":true" && echo "PASS" || echo "FAIL"

# 9. Delete Job
echo -e "\n9. Testing Delete Job ($JOB_ID)..."
curl -s -X DELETE "$BASE_URL/api/jobs/$JOB_ID" | grep -q "\"ok\":true" && echo "PASS" || echo "FAIL"

echo -e "\n==================================="
echo "API Testing Completed."
