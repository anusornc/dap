# TLS & Cross-Machine Setup

DAP supports TLS encryption for secure communication and can be accessed from any machine via ngrok tunnels.

## TLS/HTTPS Setup

### 1. Generate Certificates

For development/testing:
```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost/O=DAP Dev"
```

For production, use certificates from Let's Encrypt or your CA.

### 2. Configure TLS

Edit `.env`:
```bash
ENABLE_TLS=true
TLS_PORT=3443
TLS_CERT_PATH=./certs/cert.pem
TLS_KEY_PATH=./certs/key.pem
```

### 3. Start Server

```bash
npm run dev
# or
node --import tsx/esm src/relay/server.ts
```

Output shows:
```
╔════════════════════════════════════════════════════════╗
║           DAP Relay Server v1.0.0                      ║
╠════════════════════════════════════════════════════════╣
║  WS:     ws://0.0.0.0:3000/ws              ║
║  HTTPS:  https://0.0.0.0:3443               ║
╚════════════════════════════════════════════════════════╝
```

## Cross-Machine Access via ngrok

### Quick Test

```bash
./scripts/test-cross-machine.sh
```

### Manual Setup

1. **Start DAP relay** (if not already running):
   ```bash
   npm run dev
   ```

2. **Start ngrok tunnels** (in separate terminals):
   ```bash
   # For WebSocket connections
   ngrok http 3000

   # For TLS connections
   ngrok http 3443
   ```

3. **Note the ngrok URLs** - they look like:
   - `https://abc123.ngrok-free.app` (HTTP)
   - `https://def456.ngrok-free.app` (HTTPS)

4. **Configure your agents** to connect to the ngrok URL:
   ```javascript
   const client = new DAPClient({
     relayUrl: 'wss://abc123.ngrok-free.app/ws',
     // or for TLS:
     relayUrl: 'wss://def456.ngrok-free.app/ws',
   });
   ```

### Important Notes

- **Free tier ngrok** may disconnect after 2 hours
- **WebSocket paths** must be `/ws` (e.g., `ngrok-url/ws`)
- **Firewall**: Ensure your machine allows outbound connections on ngrok ports

## Security Considerations

| Scenario | Recommendation |
|----------|----------------|
| Development | No TLS, open access |
| Internal network | TLS + API keys |
| Public internet | TLS + API keys + rate limiting |
| Production | Real TLS certs + VPN or private network |

## Certificate Renewal

Certificates expire after 365 days. To renew:

```bash
# Backup old certs
mv certs certs.old

# Generate new certs
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=your-domain.com/O=DAP"

# Restart server
```