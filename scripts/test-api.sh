#!/bin/bash

# Claw API 测试脚本
# 使用方法: ./scripts/test-api.sh

set -e

BASE_URL="${CLAW_API_URL:-http://localhost:3000}"
echo "Testing Claw API at: $BASE_URL"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 测试计数
PASSED=0
FAILED=0

# 测试函数
test_endpoint() {
  local method=$1
  local endpoint=$2
  local data=$3
  local auth=$4
  
  echo -n "Testing $method $endpoint... "
  
  local curl_cmd="curl -s -o /dev/null -w '%{http_code}' -X $method"
  
  if [ -n "$auth" ]; then
    curl_cmd="$curl_cmd -H 'Authorization: Bearer $auth'"
  fi
  
  if [ -n "$data" ]; then
    curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$data'"
  fi
  
  curl_cmd="$curl_cmd $BASE_URL$endpoint"
  
  status=$(eval $curl_cmd || echo "000")
  
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo -e "${GREEN}✓ ($status)${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗ ($status)${NC}"
    ((FAILED++))
  fi
}

echo "=== Health Check ==="
test_endpoint "GET" "/health"

echo ""
echo "=== Public Config ==="
test_endpoint "GET" "/api/config/appearance/public"

echo ""
echo "=== Auth Endpoints ==="
test_endpoint "POST" "/api/auth/register" '{"username":"testuser","password":"testpass123","displayName":"Test User"}'
test_endpoint "POST" "/api/auth/login" '{"username":"testuser","password":"testpass123"}'

echo ""
echo "=== Groups (requires auth) ==="
echo "Skipping authenticated endpoints (need valid token)"

echo ""
echo "=== Agent Definitions (requires auth) ==="
echo "Skipping authenticated endpoints (need valid token)"

echo ""
echo "=== Skills (requires auth) ==="
echo "Skipping authenticated endpoints (need valid token)"

echo ""
echo "=== Tasks (requires auth) ==="
echo "Skipping authenticated endpoints (need valid token)"

echo ""
echo "=== Status (requires auth) ==="
echo "Skipping authenticated endpoints (need valid token)"

echo ""
echo "=== Admin (requires auth) ==="
echo "Skipping authenticated endpoints (need valid token)"

echo ""
echo "=== Test Summary ==="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
fi
