# Bearer Token Authentication

The x402 facilitator includes a comprehensive bearer token authentication system for monetizing your payment services.

## Features

- ✅ **Stripe-style token format** - `fac_test_*` and `fac_live_*` prefixes
- ✅ **Rate limiting** - Per-minute and per-day limits
- ✅ **Usage tracking** - Analytics and billing data
- ✅ **Tier-based access** - Free, Starter, Pro, Enterprise
- ✅ **In-memory storage** - Fast development (PostgreSQL/Redis ready)
- ✅ **Framework agnostic** - Works with Elysia, Hono, Express
- ✅ **Fully tested** - 100+ tests with TDD approach

## Quick Start

### 1. Enable Authentication

```bash
# .env
AUTH_ENABLED=true
```

### 2. Create Tokens

```typescript
import { InMemoryTokenStorage } from "@daydreamsai/facilitator/auth";

const storage = new InMemoryTokenStorage();

// Create a token
const token = await storage.createToken(
  {
    name: "Customer A",
    tier: "pro",
    requestsPerMinute: 500,
    requestsPerDay: 50000,
  },
  "live" // or "test"
);

console.log(token.token);
// => fac_live_7k2n9m3p1q8w5e6r2t9y4u3i
```

### 3. Use with Elysia

```typescript
import { Elysia } from "elysia";
import { createAuthPlugin } from "@daydreamsai/facilitator/auth/middleware/elysia";

const app = new Elysia()
  .use(createAuthPlugin({ enabled: true }))
  .post("/verify", ({ auth }) => {
    // auth.tokenId, auth.userId, auth.tier available
    return { success: true };
  });
```

### 4. Make Authenticated Requests

```bash
curl -X POST https://your-facilitator.com/verify \
  -H "Authorization: Bearer fac_live_7k2n9m3p1q8w5e6r2t9y4u3i" \
  -d '{ payment data }'
```

## Token Format

Tokens follow Stripe's convention:

```
fac_{environment}_{random}

Examples:
  fac_test_4x7k2n9m3p1q8w5e6r2t9y4u  (development)
  fac_live_7k2n9m3p1q8w5e6r2t9y4u3i  (production)
```

**Format:**
- Prefix: `fac` (facilitator)
- Environment: `test` or `live`
- Random: 24-character base58 string

**Benefits:**
- Easy to identify in logs
- Environment separation
- Security scannable
- Industry standard

## Configuration

### Token Properties

```typescript
interface CreateTokenInput {
  name?: string;                      // Human-readable name
  userId?: string;                    // Link to your user system
  tier?: "free" | "starter" | "pro" | "enterprise";

  // Rate limits
  requestsPerMinute?: number;         // Default: 100
  requestsPerDay?: number;            // Default: 10,000

  // Quotas
  monthlyRequestLimit?: number;       // Optional cap
  monthlySettlementLimit?: number;    // USD/USDC limit

  // Lifecycle
  expiresAt?: Date;                   // Optional expiry

  // Custom data
  metadata?: Record<string, unknown>;
}
```

### Tiers and Pricing

**Suggested Pricing Model:**

| Tier | Requests/Min | Requests/Day | Monthly Limit | Price |
|------|--------------|--------------|---------------|-------|
| Free | 10 | 100 | 1,000 | $0 |
| Starter | 100 | 10,000 | 100,000 | $10/mo |
| Pro | 500 | 50,000 | 500,000 | $50/mo |
| Enterprise | Custom | Custom | Custom | Custom |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   HTTP Request                          │
│            Authorization: Bearer fac_live_...           │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│              Elysia Auth Plugin                         │
│  ├─ Extract Authorization header                        │
│  ├─ BearerTokenValidator                                │
│  │    ├─ Validate token format                          │
│  │    ├─ Lookup in TokenStorage                         │
│  │    ├─ Check expiry                                   │
│  │    ├─ Check rate limits                              │
│  │    └─ Return AuthContext                             │
│  ├─ Increment rate limiter                              │
│  └─ Track usage                                         │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ├─ Valid → Attach auth context → Continue
                   └─ Invalid → 401 Unauthorized → Abort
```

## Components

### 1. TokenStorage

Manages API token persistence.

**In-Memory (Development):**
```typescript
import { InMemoryTokenStorage } from "@daydreamsai/facilitator/auth";

const storage = new InMemoryTokenStorage();
```

**Production (Coming Soon):**
```typescript
import { PostgresTokenStorage, CachedTokenStorage } from "@daydreamsai/facilitator/auth";

// Direct PostgreSQL
const storage = new PostgresTokenStorage(pool);

// With Redis caching
const storage = new CachedTokenStorage(
  new PostgresTokenStorage(pool),
  redis
);
```

### 2. RateLimiter

Enforces per-minute and per-day limits.

```typescript
import { InMemoryRateLimiter } from "@daydreamsai/facilitator/auth";

const limiter = new InMemoryRateLimiter();

// Check limits
const result = await limiter.check(tokenId, {
  perMinute: 100,
  perDay: 10000
});

if (!result.allowed) {
  console.log(`Rate limited. Try again at ${result.resetAt}`);
}

// Increment counter
await limiter.increment(tokenId);
```

### 3. UsageTracker

Logs requests for billing and analytics.

```typescript
import { InMemoryUsageTracker } from "@daydreamsai/facilitator/auth";

const tracker = new InMemoryUsageTracker();

// Track request
await tracker.track({
  tokenId: "token-123",
  endpoint: "/verify",
  method: "POST",
  statusCode: 200,
  success: true,
  responseTimeMs: 150,
  paymentAmount: 10.5,
  gasUsed: 0.5,
  timestamp: new Date()
});

// Get stats
const stats = await tracker.getStats(tokenId, {
  start: new Date("2024-01-01"),
  end: new Date("2024-01-31")
});

console.log(`Total requests: ${stats.totalRequests}`);
console.log(`Settlement volume: $${stats.totalSettlementVolume}`);
console.log(`Gas costs: $${stats.totalGasCost}`);
```

### 4. BearerTokenValidator

Core authentication orchestrator.

```typescript
import { BearerTokenValidator } from "@daydreamsai/facilitator/auth";

const validator = new BearerTokenValidator(storage, rateLimiter);

const result = await validator.validate("Bearer fac_live_...");

if (result.valid) {
  console.log(result.context.tokenId);
  console.log(result.context.tier);
} else {
  console.error(result.error.code);
  console.error(result.error.message);
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `MISSING_TOKEN` | 401 | Authorization header missing |
| `INVALID_TOKEN` | 401 | Token format invalid or not found |
| `INACTIVE_TOKEN` | 401 | Token has been revoked |
| `EXPIRED_TOKEN` | 401 | Token past expiry date |
| `RATE_LIMITED` | 429 | Rate limit exceeded |

## Integration Examples

### Direct Endpoints (app.ts)

```typescript
import { Elysia } from "elysia";
import { createAuthPlugin } from "./auth/middleware/elysia.js";
import { facilitator } from "./setup.js";

const app = new Elysia()
  .use(createAuthPlugin({ enabled: true }))
  .post("/verify", async ({ request, auth }) => {
    // Auth context available
    console.log(`Request from tier: ${auth?.tier}`);

    const result = await facilitator.verify(request);
    return result;
  });
```

### Framework Middleware

**Elysia:**
```typescript
import { createElysiaPaymentMiddleware } from "@daydreamsai/facilitator/elysia";
import { createAuthPlugin } from "@daydreamsai/facilitator/auth/elysia";

app
  .use(createAuthPlugin({ ... }))              // Auth first
  .use(createElysiaPaymentMiddleware({ ... })) // Then payment
  .get("/api/data", handler);
```

**Hono:**
```typescript
import { createHonoPaymentMiddleware } from "@daydreamsai/facilitator/hono";
import { createAuthMiddleware } from "@daydreamsai/facilitator/auth/hono";

app.use("*", createAuthMiddleware({ ... }));
app.use("*", createHonoPaymentMiddleware({ ... }));
```

**Express:**
```typescript
import { createExpressPaymentMiddleware } from "@daydreamsai/facilitator/express";
import { createAuthMiddleware } from "@daydreamsai/facilitator/auth/express";

app.use(createAuthMiddleware({ ... }));
app.use(createExpressPaymentMiddleware({ ... }));
```

## Monetization Strategy

### 1. Usage-Based Billing

Track usage per token for billing:

```typescript
// Get monthly usage
const stats = await tracker.getStats(tokenId, {
  start: new Date("2024-01-01"),
  end: new Date("2024-01-31")
});

// Calculate bill
const requestCost = stats.totalRequests * 0.001; // $0.001 per request
const gasCost = stats.totalGasCost * 1.1;        // Gas + 10% markup
const total = requestCost + gasCost;

console.log(`Bill for ${tokenId}: $${total.toFixed(2)}`);
```

### 2. Tier Enforcement

```typescript
app.get("/premium-feature", ({ auth, set }) => {
  if (auth.tier === "free") {
    set.status = 403;
    return { error: "Upgrade to Pro for this feature" };
  }

  // Feature logic...
});
```

### 3. Rate Limit Headers

```typescript
app.use(async ({ request, set, auth }) => {
  if (!auth) return;

  const usage = await rateLimiter.getUsage(auth.tokenId);

  set.headers["X-RateLimit-Remaining"] = String(
    token.requestsPerMinute - usage.currentMinute
  );
  set.headers["X-RateLimit-Limit"] = String(token.requestsPerMinute);
});
```

## Token Management API (Future)

You'll build this separately to generate tokens:

```typescript
// Admin API endpoints
POST   /api/admin/tokens           // Create new token
GET    /api/admin/tokens           // List all tokens
GET    /api/admin/tokens/:id       // Get token details
PATCH  /api/admin/tokens/:id       // Update token
DELETE /api/admin/tokens/:id       // Revoke token
GET    /api/admin/tokens/:id/usage // Get usage stats
```

## Production Deployment

### Environment Variables

```bash
# Authentication
AUTH_ENABLED=true

# Database (when ready for production)
DATABASE_URL=postgresql://user:password@localhost:5432/facilitator
REDIS_URL=redis://localhost:6379

# Rate Limiting
RATE_LIMIT_ENABLED=true

# Usage Tracking
USAGE_TRACKING_ENABLED=true
```

### Migration to Production Storage

1. **Add Dependencies:**
```bash
npm install pg ioredis
npm install --save-dev @types/pg
```

2. **Create Adapters** (coming soon):
```typescript
import { PostgresTokenStorage, RedisRateLimiter } from "@daydreamsai/facilitator/auth";
```

3. **Swap Implementation:**
```typescript
// Development
const storage = new InMemoryTokenStorage();

// Production
const storage = new PostgresTokenStorage(pool);
```

## Security Best Practices

1. **Never log tokens** - Only log token IDs
2. **Use HTTPS** - Always require TLS in production
3. **Rotate tokens** - Set expiry dates
4. **Monitor usage** - Watch for suspicious patterns
5. **Rate limit strictly** - Prevent abuse
6. **Validate environment** - Don't accept test tokens in prod

## Testing

```typescript
import { describe, test, expect } from "bun:test";
import { InMemoryTokenStorage, BearerTokenValidator } from "./auth/index.js";

describe("Auth Integration", () => {
  test("validates token", async () => {
    const storage = new InMemoryTokenStorage();
    const token = await storage.createToken({ name: "Test" }, "test");

    const validator = new BearerTokenValidator(storage, rateLimiter);
    const result = await validator.validate(`Bearer ${token.token}`);

    expect(result.valid).toBe(true);
  });
});
```

Run tests:
```bash
bun test tests/auth/
```

## FAQ

**Q: Can I use this without x402 payments?**
A: Yes! The auth system is independent and can protect any endpoint.

**Q: How do I generate tokens for customers?**
A: Build a separate admin API using the `TokenStorage` interface.

**Q: Can I customize rate limits per token?**
A: Yes! Set `requestsPerMinute` and `requestsPerDay` when creating tokens.

**Q: Is Redis required?**
A: No. In-memory storage works for development. Redis is recommended for production.

**Q: How do I track costs for billing?**
A: Use `UsageTracker` to log payment amounts, gas costs, and request counts.

## Support

- GitHub Issues: https://github.com/daydreamsai/facilitator/issues
- Documentation: https://github.com/daydreamsai/facilitator#readme
