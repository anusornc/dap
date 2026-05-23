#!/bin/bash
# Cross-machine integration test using ngrok tunnels
# Usage: ./scripts/test-cross-machine.sh

set -e

cd "$(dirname "$0")/.."

echo "=== DAP Cross-Machine Integration Test ==="
echo ""

# Start relay server in background
echo "[1/4] Starting DAP relay server..."
node --import tsx/esm src/relay/server.ts &
RELAY_PID=$!
sleep 3

# Start ngrok tunnel for HTTP
echo "[2/4] Starting ngrok tunnel for HTTP (port 3000)..."
ngrok http 3000 --log=stdout > /tmp/ngrok-http.log 2>&1 &
NGROK_PID=$!
sleep 3

# Extract ngrok URLs
HTTP_URL=$(grep "url=" /tmp/ngrok-http.log | head -1 | sed 's/.*url=//')
echo "  HTTP URL: $HTTP_URL"

# Start ngrok tunnel for HTTPS/WSS
echo "[3/4] Starting ngrok tunnel for HTTPS (port 3443)..."
ngrok http 3443 --log=stdout > /tmp/ngrok-https.log 2>&1 &
NGROK_HTTPS_PID=$!
sleep 3

HTTPS_URL=$(grep "url=" /tmp/ngrok-https.log | head -1 | sed 's/.*url=//')
echo "  HTTPS URL: $HTTPS_URL"

# Test connectivity
echo "[4/4] Testing cross-machine connectivity..."
echo ""

echo "=== HTTP Tunnel Test ==="
curl -s "$HTTP_URL/health" | head -c 200
echo ""
echo ""

echo "=== WebSocket Connection Test ==="
# Simple WebSocket test using wscat or websocat if available
if command -v wscat &> /dev/null; then
    echo "Connecting via WebSocket..."
    timeout 5 wscat -c "$HTTP_URL/ws" <<< '{"action":"ping"}' || echo "(timeout expected)"
elif command -v websocat &> /dev/null; then
    echo "Connecting via websocat..."
    timeout 5 bash -c "echo '{\"action\":\"ping\"}' | websocat '$HTTP_URL/ws'" || echo "(timeout expected)"
else
    echo "wscat/websocat not found. Install with: npm install -g wscat"
fi

echo ""
echo "=== Test Complete ==="

# Cleanup
echo "Cleaning up..."
kill $NGROK_HTTPS_PID $NGROK_PID $RELAY_PID 2>/dev/null || true

echo "Done!"
echo ""
echo "To expose your relay permanently, run:"
echo "  ngrok http 3000"
echo "  ngrok http 3443"
echo ""
echo "Your agents can connect using:"
echo "  HTTP:  $HTTP_URL"
echo "  HTTPS: $HTTPS_URL"