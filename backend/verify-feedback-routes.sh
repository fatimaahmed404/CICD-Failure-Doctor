#!/bin/bash
# Manual verification script for Task 19.2 feedback routes
# This demonstrates the POST /diagnoses/:id/feedback and GET /feedback/stats endpoints

set -e

echo "=== Task 19.2 Verification: Feedback Routes ==="
echo ""

# Check if server is running
if ! nc -z localhost 3000 2>/dev/null; then
    echo "Error: Server not running on port 3000"
    echo "Start the server with: npm run dev"
    exit 1
fi

echo "✓ Server is running"
echo ""

# Test 1: GET /feedback/stats (should return all 7 categories with zero counts)
echo "Test 1: GET /feedback/stats (empty state)"
echo "----------------------------------------"
STATS_RESPONSE=$(curl -s http://localhost:3000/feedback/stats)
echo "Response: $STATS_RESPONSE" | jq .
echo ""

# Count categories returned
CATEGORY_COUNT=$(echo "$STATS_RESPONSE" | jq '.stats | length')
if [ "$CATEGORY_COUNT" -eq 7 ]; then
    echo "✓ Returns all 7 categories"
else
    echo "✗ Expected 7 categories, got $CATEGORY_COUNT"
    exit 1
fi
echo ""

# Test 2: Create a build record for feedback testing
echo "Test 2: Create a build record via /simulate"
echo "--------------------------------------------"
SIMULATE_RESPONSE=$(curl -s -X POST http://localhost:3000/simulate \
    -H "Content-Type: application/json" \
    -d '{"scenario":"test-failure"}')
BUILD_ID=$(echo "$SIMULATE_RESPONSE" | jq -r .id)
echo "Created build record: $BUILD_ID"
echo ""

# Wait a moment for processing
echo "Waiting for diagnosis to complete..."
sleep 3
echo ""

# Test 3: POST /diagnoses/:id/feedback with missing X-Client-Id (should return 400)
echo "Test 3: POST /diagnoses/:id/feedback without X-Client-Id header"
echo "----------------------------------------------------------------"
ERROR_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
    http://localhost:3000/diagnoses/$BUILD_ID/feedback \
    -H "Content-Type: application/json" \
    -d '{"rating":"helpful"}')
HTTP_CODE=$(echo "$ERROR_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$ERROR_RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" -eq 400 ]; then
    echo "✓ Correctly returns 400 for missing X-Client-Id"
    echo "Response: $RESPONSE_BODY" | jq .
else
    echo "✗ Expected 400, got $HTTP_CODE"
    exit 1
fi
echo ""

# Test 4: POST /diagnoses/:id/feedback with invalid rating (should return 400)
echo "Test 4: POST /diagnoses/:id/feedback with invalid rating"
echo "---------------------------------------------------------"
ERROR_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
    http://localhost:3000/diagnoses/$BUILD_ID/feedback \
    -H "Content-Type: application/json" \
    -H "X-Client-Id: test-client-123" \
    -d '{"rating":"invalid"}')
HTTP_CODE=$(echo "$ERROR_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$ERROR_RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" -eq 400 ]; then
    echo "✓ Correctly returns 400 for invalid rating"
    echo "Response: $RESPONSE_BODY" | jq .
    ERROR_MSG=$(echo "$RESPONSE_BODY" | jq -r .error)
    if [ "$ERROR_MSG" = "Invalid rating value" ]; then
        echo "✓ Error message matches spec: 'Invalid rating value'"
    else
        echo "✗ Expected 'Invalid rating value', got '$ERROR_MSG'"
        exit 1
    fi
else
    echo "✗ Expected 400, got $HTTP_CODE"
    exit 1
fi
echo ""

# Test 5: POST /diagnoses/:id/feedback with valid helpful rating (should return 200)
echo "Test 5: POST /diagnoses/:id/feedback with valid 'helpful' rating"
echo "-----------------------------------------------------------------"
FEEDBACK_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
    http://localhost:3000/diagnoses/$BUILD_ID/feedback \
    -H "Content-Type: application/json" \
    -H "X-Client-Id: test-client-123" \
    -d '{"rating":"helpful"}')
HTTP_CODE=$(echo "$FEEDBACK_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$FEEDBACK_RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✓ Successfully submitted helpful feedback"
    echo "Response: $RESPONSE_BODY" | jq .
    
    # Verify response structure
    FEEDBACK_ID=$(echo "$RESPONSE_BODY" | jq -r .id)
    RATING=$(echo "$RESPONSE_BODY" | jq -r .rating)
    
    if [ -n "$FEEDBACK_ID" ] && [ "$RATING" = "helpful" ]; then
        echo "✓ Response contains correct feedback record"
    else
        echo "✗ Response structure incorrect"
        exit 1
    fi
else
    echo "✗ Expected 200, got $HTTP_CODE"
    exit 1
fi
echo ""

# Test 6: POST /diagnoses/:id/feedback with valid unhelpful rating from different client
echo "Test 6: POST /diagnoses/:id/feedback with 'unhelpful' from another client"
echo "--------------------------------------------------------------------------"
FEEDBACK_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
    http://localhost:3000/diagnoses/$BUILD_ID/feedback \
    -H "Content-Type: application/json" \
    -H "X-Client-Id: test-client-456" \
    -d '{"rating":"unhelpful"}')
HTTP_CODE=$(echo "$FEEDBACK_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✓ Successfully submitted unhelpful feedback"
else
    echo "✗ Expected 200, got $HTTP_CODE"
    exit 1
fi
echo ""

# Test 7: GET /feedback/stats (should show updated counts)
echo "Test 7: GET /feedback/stats (with feedback)"
echo "--------------------------------------------"
STATS_RESPONSE=$(curl -s http://localhost:3000/feedback/stats)
echo "Response: $STATS_RESPONSE" | jq .
echo ""

# Verify test-failure category has counts
TEST_FAILURE_STATS=$(echo "$STATS_RESPONSE" | jq '.stats[] | select(.category=="test-failure")')
HELPFUL_COUNT=$(echo "$TEST_FAILURE_STATS" | jq .helpful)
UNHELPFUL_COUNT=$(echo "$TEST_FAILURE_STATS" | jq .unhelpful)

if [ "$HELPFUL_COUNT" -ge 1 ] && [ "$UNHELPFUL_COUNT" -ge 1 ]; then
    echo "✓ Stats correctly reflect submitted feedback"
    echo "  test-failure: helpful=$HELPFUL_COUNT, unhelpful=$UNHELPFUL_COUNT"
else
    echo "✗ Stats do not reflect feedback correctly"
    exit 1
fi
echo ""

echo "=========================================="
echo "✓ All Task 19.2 verification tests passed!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✓ POST /diagnoses/:id/feedback validates X-Client-Id header"
echo "  ✓ POST /diagnoses/:id/feedback validates rating values"
echo "  ✓ POST /diagnoses/:id/feedback accepts 'helpful' and 'unhelpful'"
echo "  ✓ POST /diagnoses/:id/feedback returns 200 with FeedbackResponse"
echo "  ✓ GET /feedback/stats returns all 7 categories"
echo "  ✓ GET /feedback/stats shows correct counts"
