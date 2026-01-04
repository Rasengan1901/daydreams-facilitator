# Integration Guide: Adding Auth to app.ts

This guide shows how to integrate bearer token authentication into your existing facilitator.

## Option 1: Quick Integration (Recommended)

Add auth to your existing `src/app.ts`:

```typescript
import { Elysia } from "elysia";
import { nodeServer } from "@elysiajs/node";
import logger from "@bogeychan/elysia-logger";
import { facilitator } from "./setup.js";

// Import auth plugin
import { createAuthPlugin } from "./auth/middleware/elysia.js";

const app = new Elysia({ adapter: nodeServer() })
  .use(logger)

  // Add auth before routes
  .use(createAuthPlugin({
    enabled: process.env.AUTH_ENABLED === "true"
  }))

  .get("/", async () => {
    // ... existing code
  })
  .post("/verify", async ({ request, auth }) => {
    // Auth context now available!
    console.log(`Verify request from tier: ${auth?.tier}`);

    const result = await facilitator.verify(request);
    return result;
  })
  .post("/settle", async ({ request, auth }) => {
    console.log(`Settle request from tier: ${auth?.tier}`);

    const result = await facilitator.settle(request);
    return result;
  })
  .get("/supported", async () => {
    const result = await facilitator.getSupported();
    return result;
  });

export default app;
```

## Option 2: Custom Configuration

For more control over storage and tracking:

```typescript
import { createAuthPlugin } from "./auth/middleware/elysia.js";
import {
  InMemoryTokenStorage,
  InMemoryRateLimiter,
  InMemoryUsageTracker,
} from "./auth/index.js";

// Create instances
const storage = new InMemoryTokenStorage();
const rateLimiter = new InMemoryRateLimiter();
const tracker = new InMemoryUsageTracker();

// Pre-create some tokens
const setupTokens = async () => {
  const token = await storage.createToken(
    {
      name: "Development Token",
      tier: "pro",
      requestsPerMinute: 100,
      requestsPerDay: 10000,
    },
    "test"
  );

  console.log(`Dev token: ${token.token}`);
};

setupTokens();

const app = new Elysia({ adapter: nodeServer() })
  .use(logger)
  .use(createAuthPlugin({
    enabled: process.env.AUTH_ENABLED === "true",
    storage,
    rateLimiter,
    tracker,
  }))
  // ... routes
```

## Environment Setup

Add to `.env`:

```bash
# Enable authentication
AUTH_ENABLED=true
```

## Testing Integration

### 1. Start the server

```bash
bun run dev
```

### 2. Create a test token

```typescript
// Quick script: scripts/createToken.ts
import { InMemoryTokenStorage } from "./src/auth/index.js";

const storage = new InMemoryTokenStorage();
const token = await storage.createToken(
  { name: "Test User", tier: "pro" },
  "test"
);

console.log(`Token: ${token.token}`);
```

```bash
bun run scripts/createToken.ts
```

### 3. Make authenticated requests

```bash
# Without token (should fail)
curl http://localhost:3000/verify

# With token (should succeed)
curl -H "Authorization: Bearer fac_test_YOUR_TOKEN" \
  http://localhost:3000/verify
```

## Conditional Auth (Optional Endpoints)

If you want some endpoints protected and others public:

```typescript
const app = new Elysia()
  .use(logger)

  // Public endpoint (before auth)
  .get("/", () => ({ message: "Public endpoint" }))

  // Add auth
  .use(createAuthPlugin({ enabled: true }))

  // Protected endpoints (after auth)
  .post("/verify", async ({ request, auth }) => {
    // Requires auth
  })
  .post("/settle", async ({ request, auth }) => {
    // Requires auth
  });
```

## Accessing Auth Context

The `auth` object is available in all route handlers after authentication:

```typescript
.post("/verify", async ({ request, auth, set }) => {
  // Check if authenticated
  if (!auth) {
    set.status = 401;
    return { error: "Not authenticated" };
  }

  // Access auth properties
  console.log({
    tokenId: auth.tokenId,
    userId: auth.userId,
    tier: auth.tier,
    metadata: auth.metadata,
  });

  // Tier-based logic
  if (auth.tier === "free") {
    // Apply free tier restrictions
  }

  // Continue with verification
  const result = await facilitator.verify(request);
  return result;
});
```

## Production Checklist

Before going live:

- [ ] Set `AUTH_ENABLED=true` in production env
- [ ] Create tokens for customers
- [ ] Set appropriate rate limits per tier
- [ ] Monitor usage via tracker
- [ ] Plan migration to PostgreSQL/Redis
- [ ] Implement token management API
- [ ] Set up billing integration
- [ ] Test rate limiting behavior
- [ ] Document API for customers
- [ ] Set up monitoring/alerting

## Next Steps

1. **Create Token Management API** - Build endpoints to generate tokens for customers
2. **Add Billing Integration** - Use `UsageTracker` stats for monthly billing
3. **Migrate to Production Storage** - Switch to PostgreSQL + Redis
4. **Dashboard** - Build admin panel to view tokens and usage
5. **Webhooks** - Notify customers when approaching limits

## Troubleshooting

### Auth not working

1. Check `AUTH_ENABLED=true` in .env
2. Verify token format: `fac_{test|live}_{24-chars}`
3. Ensure Bearer prefix: `Authorization: Bearer <token>`

### Rate limits too strict

Adjust when creating tokens:

```typescript
const token = await storage.createToken({
  requestsPerMinute: 1000,  // Increase
  requestsPerDay: 100000,   // Increase
}, "live");
```

### Token not found

Tokens are in-memory and lost on restart. For persistence:
- Use PostgreSQL storage (coming soon)
- Or re-create tokens on startup

## Example: Full Integration

See `examples/authExample.ts` for a complete working example with:
- Token creation
- Protected endpoints
- Tier-based access
- Usage tracking
- Rate limiting

Run it:

```bash
bun run examples/authExample.ts
```

Then test with the provided curl commands!
