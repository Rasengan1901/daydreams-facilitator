# x402 Facilitator

> **Warning**: This project is currently in alpha. APIs may change without notice and should not be used in production environments without thorough testing.

A production-ready payment settlement service for the [x402 protocol](https://github.com/coinbase/x402). Built with Elysia and Node.js, it verifies cryptographic payment signatures and settles transactions on-chain for EVM (Base) and SVM (Solana) networks.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Custom Signers](#custom-signers)
- [API Reference](#api-reference)
- [Payment Schemes](#payment-schemes)
- [Upto Module](#upto-module)
- [Resource Server](#resource-server)
- [Testing](#testing)
- [Production Deployment](#production-deployment)

## Overview

The x402 Facilitator acts as a trusted intermediary between clients making payments and resource servers providing paid content. It:

1. **Verifies** payment signatures and authorizations
2. **Settles** transactions on-chain (EVM/Solana)
3. **Manages** batched payment sessions for efficient settlement (upto scheme)

### Supported Networks

| Network        | CAIP-2 Identifier                         | Schemes     |
| -------------- | ----------------------------------------- | ----------- |
| Base Mainnet   | `eip155:8453`                             | exact, upto |
| Base Sepolia   | `eip155:84532`                            | exact, upto |
| Ethereum       | `eip155:1`                                | exact, upto |
| Optimism       | `eip155:10`                               | exact, upto |
| Arbitrum       | `eip155:42161`                            | exact, upto |
| Polygon        | `eip155:137`                              | exact, upto |
| Solana Devnet  | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | exact       |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | exact       |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         x402 Facilitator                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   /verify    │    │   /settle    │    │  /supported  │          │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘          │
│         │                   │                                       │
│         ▼                   ▼                                       │
│  ┌─────────────────────────────────────────────────────┐           │
│  │              Payment Scheme Registry                 │           │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │           │
│  │  │ Exact (EVM) │  │ Upto (EVM)  │  │ Exact (SVM) │  │           │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │           │
│  └─────────────────────────────────────────────────────┘           │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                │
│         ▼                    ▼                    ▼                │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐        │
│  │ EVM Signer  │      │ SVM Signer  │      │Session Store│        │
│  │ (Viem/CDP)  │      │(Solana Kit) │      │ (In-Memory) │        │
│  └──────┬──────┘      └──────┬──────┘      └──────┬──────┘        │
│         │                    │                    │                │
└─────────┼────────────────────┼────────────────────┼────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
   │  EVM RPC    │      │ Solana RPC  │      │  Sweeper    │
   └─────────────┘      └─────────────┘      └─────────────┘
```

### Core Components

| Component           | File                          | Responsibility                              |
| ------------------- | ----------------------------- | ------------------------------------------- |
| HTTP Server         | `src/app.ts`                  | Elysia server with endpoints and middleware |
| Facilitator Factory | `src/factory.ts`              | `createFacilitator()` with signer injection |
| CDP Signer          | `src/signers/cdp.ts`          | Coinbase Developer Platform adapter         |
| Upto Scheme         | `src/upto/evm/facilitator.ts` | Permit-based batched payments               |
| Session Store       | `src/upto/store.ts`           | In-memory session management                |
| Sweeper             | `src/upto/sweeper.ts`         | Background batch settlement                 |

### Data Flow

**Exact Payment (Immediate Settlement)**

```
Client → POST /verify → Signature validation → VerifyResponse
Client → POST /settle → On-chain transfer → SettleResponse (tx hash)
```

**Upto Payment (Batched Settlement)**

```
Client → POST /verify → Permit validation → Session created/updated
              ↓
         Accumulate pending spend across requests
              ↓
         Sweeper triggers → POST /settle (batch) → Reset pending
```

## Quick Start

### Prerequisites

- Node.js v22+ or Bun
- CDP account (recommended) or EVM/SVM private keys

### As a Library

```typescript
import { createFacilitator } from "@daydreamsai/facilitator";
import { createCdpEvmSigner } from "@daydreamsai/facilitator/signers/cdp";
import { CdpClient } from "@coinbase/cdp-sdk";

// Initialize CDP
const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name: "facilitator" });

// Create signer
const signer = createCdpEvmSigner({
  cdpClient: cdp,
  account,
  network: "base",
  rpcUrl: process.env.EVM_RPC_URL_BASE,
});

// Create facilitator
const facilitator = createFacilitator({
  evmSigners: [{ signer, networks: "eip155:8453", schemes: ["exact", "upto"] }],
});
```

### From Source

```bash
# Clone and install
git clone https://github.com/daydreamsai/facilitator
cd facilitator
bun install

# Configure environment
cp .env-local .env
# Edit .env with your CDP credentials or private keys

# Start development server
bun dev
```

### Verify Installation

```bash
curl http://localhost:8090/supported
```

## Configuration

### Environment Variables

**CDP Signer (Recommended)**

| Variable             | Required | Default | Description        |
| -------------------- | -------- | ------- | ------------------ |
| `CDP_API_KEY_ID`     | Yes      | -       | CDP API key ID     |
| `CDP_API_KEY_SECRET` | Yes      | -       | CDP API key secret |
| `CDP_WALLET_SECRET`  | Yes      | -       | CDP wallet secret  |
| `CDP_ACCOUNT_NAME`   | No       | -       | CDP account name   |

**Private Key Signer (Fallback)**

| Variable           | Required | Default | Description                        |
| ------------------ | -------- | ------- | ---------------------------------- |
| `EVM_PRIVATE_KEY`  | Yes\*    | -       | Ethereum private key (hex format)  |
| `SVM_PRIVATE_KEY`  | Yes\*    | -       | Solana private key (Base58 format) |

\*Required when CDP credentials are not configured.

**Server Configuration**

| Variable           | Required | Default | Description             |
| ------------------ | -------- | ------- | ----------------------- |
| `PORT`             | No       | `8090`  | Server port             |
| `EVM_RPC_URL_BASE` | No       | -       | Custom RPC URL for Base |

### OpenTelemetry (Optional)

Enable distributed tracing:

```bash
export OTEL_SERVICE_NAME="x402-facilitator"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
```

## Custom Signers

### CDP Signer (Recommended)

Use [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) for managed key custody:

```typescript
import { createFacilitator } from "@daydreamsai/facilitator";
import { createCdpEvmSigner } from "@daydreamsai/facilitator/signers/cdp";
import { CdpClient } from "@coinbase/cdp-sdk";

const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name: "facilitator" });

const signer = createCdpEvmSigner({
  cdpClient: cdp,
  account,
  network: "base",
  rpcUrl: process.env.EVM_RPC_URL_BASE,
});

const facilitator = createFacilitator({
  evmSigners: [
    { signer, networks: "eip155:8453", schemes: ["exact", "upto"] },
  ],
});
```

### Multi-Network CDP Setup

```typescript
import { createFacilitator } from "@daydreamsai/facilitator";
import { createMultiNetworkCdpSigners } from "@daydreamsai/facilitator/signers/cdp";

const signers = createMultiNetworkCdpSigners({
  cdpClient: cdp,
  account,
  networks: {
    base: process.env.EVM_RPC_URL_BASE,
    "base-sepolia": process.env.BASE_SEPOLIA_RPC_URL,
    optimism: process.env.OPTIMISM_RPC_URL,
  },
});

const facilitator = createFacilitator({
  evmSigners: [
    { signer: signers.base!, networks: "eip155:8453" },
    { signer: signers["base-sepolia"]!, networks: "eip155:84532" },
    { signer: signers.optimism!, networks: "eip155:10" },
  ],
});
```

### CDP Network Mapping

| CDP Network        | CAIP-2            | Chain ID |
| ------------------ | ----------------- | -------- |
| `base`             | `eip155:8453`     | 8453     |
| `base-sepolia`     | `eip155:84532`    | 84532    |
| `ethereum`         | `eip155:1`        | 1        |
| `ethereum-sepolia` | `eip155:11155111` | 11155111 |
| `optimism`         | `eip155:10`       | 10       |
| `arbitrum`         | `eip155:42161`    | 42161    |
| `polygon`          | `eip155:137`      | 137      |
| `avalanche`        | `eip155:43114`    | 43114    |

### Lifecycle Hooks

Add custom logic at key points:

```typescript
const facilitator = createFacilitator({
  evmSigners: [{ signer, networks: "eip155:8453" }],
  hooks: {
    onBeforeVerify: async (ctx) => {
      // Rate limiting, logging
    },
    onAfterVerify: async (ctx) => {
      // Track verified payments
    },
    onVerifyFailure: async (ctx) => {
      // Handle verification failures
    },
    onBeforeSettle: async (ctx) => {
      // Validate before settlement
    },
    onAfterSettle: async (ctx) => {
      // Analytics, notifications
    },
    onSettleFailure: async (ctx) => {
      // Alerting, retry logic
    },
  },
});
```

## API Reference

### GET /supported

Returns supported payment schemes and networks.

**Response:**

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "eip155:8453" },
    { "x402Version": 2, "scheme": "upto", "network": "eip155:8453" }
  ],
  "signers": {
    "eip155": ["0x..."]
  }
}
```

### POST /verify

Validates a payment signature against requirements.

**Request:**

```json
{
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "1000",
      "payTo": "0x..."
    },
    "payload": { "signature": "0x...", "authorization": {} }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000",
    "payTo": "0x..."
  }
}
```

**Response (Success):**

```json
{ "isValid": true, "payer": "0x..." }
```

**Response (Failure):**

```json
{ "isValid": false, "invalidReason": "invalid_signature" }
```

### POST /settle

Executes on-chain payment settlement.

**Request:** Same as `/verify`

**Response (Success):**

```json
{
  "success": true,
  "transaction": "0x...",
  "network": "eip155:8453",
  "payer": "0x..."
}
```

**Response (Failure):**

```json
{
  "success": false,
  "errorReason": "insufficient_balance",
  "network": "eip155:8453"
}
```

## Payment Schemes

### Exact Scheme

Immediate, single-transaction settlement. Each payment request results in one on-chain transfer.

**Supported tokens:**

- USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- SPL tokens on Solana

### Upto Scheme (Batched Payments)

Permit-based flow for efficient EVM token payments:

1. **Client signs once** - ERC-2612 Permit for a cap amount
2. **Multiple requests** - Reuse the same Permit signature
3. **Automatic batching** - Sweeper settles accumulated spend
4. **Settlement triggers:**
   - Idle timeout (2 minutes of inactivity)
   - Deadline buffer (60 seconds before Permit expires)
   - Cap threshold (90% of cap reached)

**Session Lifecycle:**

```
┌─────────┐     verify      ┌─────────┐     sweep/close     ┌─────────┐
│  None   │ ───────────────▶│  Open   │ ──────────────────▶ │ Closed  │
└─────────┘                 └────┬────┘                     └─────────┘
                                 │ settle
                                 ▼
                            ┌─────────┐
                            │Settling │
                            └────┬────┘
                                 │ success
                                 ▼
                            Back to Open (if cap/deadline allow)
```

**Limitations:**

- ERC-2612 Permit tokens only
- In-memory sessions (lost on restart without custom store)

## Upto Module

The upto module provides components for batched payment tracking on resource servers.

### Installation

```typescript
import {
  createUptoModule,
  trackUptoPayment,
  generateSessionId,
  formatSession,
  TRACKING_ERROR_MESSAGES,
  TRACKING_ERROR_STATUS,
} from "@daydreamsai/facilitator/upto";
```

### Creating an Upto Module

```typescript
import { createUptoModule } from "@daydreamsai/facilitator/upto";
import { HTTPFacilitatorClient } from "@x402/core/http";

const facilitatorClient = new HTTPFacilitatorClient({
  url: "http://localhost:8090",
});

const upto = createUptoModule({
  facilitatorClient,
  // Optional: custom session store (defaults to InMemoryUptoSessionStore)
  // store: new RedisSessionStore(),
});

// Use the sweeper plugin for automatic settlement
app.use(upto.sweeper);
```

### Tracking Payments

```typescript
import { trackUptoPayment, TRACKING_ERROR_STATUS } from "@daydreamsai/facilitator/upto";

const result = trackUptoPayment(upto.store, paymentPayload, requirements);

if (!result.success) {
  // Handle error
  const status = TRACKING_ERROR_STATUS[result.error];
  return { error: result.error, status };
}

// Payment tracked successfully
console.log(`Session ${result.sessionId} updated`);
console.log(`Pending: ${result.session.pendingSpent}`);
```

### Custom Session Store

Replace in-memory storage with persistent storage:

```typescript
import type { UptoSessionStore, UptoSession } from "@daydreamsai/facilitator/upto";

class RedisSessionStore implements UptoSessionStore {
  get(id: string): UptoSession | undefined {
    /* Redis get */
  }
  set(id: string, session: UptoSession): void {
    /* Redis set */
  }
  delete(id: string): void {
    /* Redis del */
  }
  entries(): IterableIterator<[string, UptoSession]> {
    /* Redis scan */
  }
}
```

## Resource Server

Pre-configured resource server with all schemes registered:

```typescript
import { createResourceServer } from "@daydreamsai/facilitator/server";
import { HTTPFacilitatorClient } from "@x402/core/http";

const facilitatorClient = new HTTPFacilitatorClient({
  url: "http://localhost:8090",
});

const resourceServer = createResourceServer(facilitatorClient);
await resourceServer.initialize();

// Use with payment middleware
resourceServer.onAfterVerify(async (ctx) => {
  if (ctx.requirements.scheme === "upto") {
    // Track upto sessions
  }
});
```

## Testing

```bash
# Run tests
bun test

# Watch mode
bun test:watch

# Coverage
bun test:coverage
```

### Smoke Testing

1. Start the facilitator:

   ```bash
   bun dev
   ```

2. Start the demo paid API:

   ```bash
   bun smoke:api
   ```

3. Run the smoke client:
   ```bash
   export CLIENT_EVM_PRIVATE_KEY="0x..."
   bun smoke:upto
   ```

## Production Deployment

### Security Considerations

1. **Private Key Management**
   - Use CDP for managed custody (recommended)
   - Or use secrets managers (AWS Secrets Manager, HashiCorp Vault)
   - Never commit `.env` files with real keys

2. **Network Security**
   - Run behind a reverse proxy (nginx, Cloudflare)
   - Enable TLS/HTTPS
   - Implement rate limiting

3. **Signature Validation**
   - All signatures verified via EIP-712 typed data
   - Permit deadlines enforced with buffer
   - Network/chain ID validation prevents replay attacks

### Scaling

1. **Session Persistence**
   - Replace `InMemoryUptoSessionStore` with Redis/PostgreSQL
   - Required for multi-instance deployments

2. **RPC Resilience**
   - Configure multiple RPC endpoints
   - Implement retry logic with exponential backoff

3. **Monitoring**
   - Enable OpenTelemetry tracing
   - Set up alerts for settlement failures

### Example Deployment

```yaml
# docker-compose.yml
services:
  facilitator:
    build: .
    environment:
      - CDP_API_KEY_ID=${CDP_API_KEY_ID}
      - CDP_API_KEY_SECRET=${CDP_API_KEY_SECRET}
      - CDP_WALLET_SECRET=${CDP_WALLET_SECRET}
      - PORT=8090
    ports:
      - "8090:8090"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8090/supported"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Network Identifiers

Networks use [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format:

| Network          | Identifier                                |
| ---------------- | ----------------------------------------- |
| Ethereum Mainnet | `eip155:1`                                |
| Base Mainnet     | `eip155:8453`                             |
| Base Sepolia     | `eip155:84532`                            |
| Optimism         | `eip155:10`                               |
| Arbitrum         | `eip155:42161`                            |
| Polygon          | `eip155:137`                              |
| Solana Devnet    | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Solana Mainnet   | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |

## License

MIT
