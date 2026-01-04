# Bearer Token Authentication System - Technical Design Plan

## Executive Summary

This document outlines the implementation of a production-ready bearer token authentication system for the x402 facilitator. The design follows a **test-driven development (TDD)** approach with **interfaces-first** architecture, allowing rapid iteration with in-memory storage before migrating to production databases.

## Design Principles

1. **Interface-Driven Design** - Define contracts first, implementations second
2. **Storage Agnostic** - Swap between in-memory, PostgreSQL, Redis without code changes
3. **Test-First** - Every feature has failing tests before implementation
4. **Zero Breaking Changes** - Authentication is opt-in via configuration
5. **Framework Agnostic Core** - Works with Elysia, Hono, Express, and future frameworks

## Token Format Specification

### Stripe-Style Prefix Format

```
fac_{environment}_{random}

Examples:
  fac_test_4x7k2n9m3p1q8w5e6r2t9y4u
  fac_live_7k2n9m3p1q8w5e6r2t9y4u3i
```

**Components:**
- `fac` - Prefix indicating "facilitator" token
- `{environment}` - Either `test` or `live`
- `{random}` - 24-character random string (base58 encoding)

**Benefits:**
- Easy to identify in logs/code
- Environment separation prevents prod/test mixing
- Scannable in security audits
- Follows industry standards (Stripe, Twilio, etc.)

**Implementation:**
```typescript
// Test environment tokens
generateToken('test') => 'fac_test_...'

// Production tokens
generateToken('live') => 'fac_live_...'
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   HTTP Request                          │
│            Authorization: Bearer fac_live_...           │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│              Auth Middleware Layer                      │
│  ┌────────────────────────────────────────────────┐    │
│  │  Framework Adapter (Elysia/Hono/Express)       │    │
│  │    ├─ Extract Authorization header             │    │
│  │    └─ Normalize request context                │    │
│  └────────────────┬───────────────────────────────┘    │
│                   │                                      │
│  ┌────────────────▼───────────────────────────────┐    │
│  │  BearerTokenValidator (Core Logic)             │    │
│  │    ├─ Parse token format                       │    │
│  │    ├─ Validate token via TokenStorage          │    │
│  │    ├─ Check rate limits via RateLimiter        │    │
│  │    └─ Return AuthContext or error              │    │
│  └────────────────┬───────────────────────────────┘    │
│                   │                                      │
│  ┌────────────────▼───────────────────────────────┐    │
│  │  Storage Layer (Interface-based)               │    │
│  │    ├─ TokenStorage (get/validate tokens)       │    │
│  │    ├─ RateLimiter (check/increment limits)     │    │
│  │    └─ UsageTracker (log requests)              │    │
│  └────────────────────────────────────────────────┘    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ├─ Valid → Attach auth context → Continue
                   └─ Invalid → 401 Unauthorized → Abort
```

## Core Interfaces

### 1. TokenStorage Interface

**Purpose:** Abstract token persistence and retrieval

```typescript
export interface ApiToken {
  id: string;                        // UUID
  token: string;                     // Full token: fac_live_...
  tokenHash: string;                 // SHA256 hash for secure lookup
  name: string | null;               // Human-readable name
  userId: string | null;             // Optional user identifier
  tier: 'free' | 'starter' | 'pro' | 'enterprise';

  // Rate limits
  requestsPerMinute: number;
  requestsPerDay: number;

  // Quotas (optional)
  monthlyRequestLimit: number | null;
  monthlySettlementLimit: number | null; // In USD/USDC

  // Status
  isActive: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;

  // Metadata (flexible)
  metadata: Record<string, unknown>;
}

export interface CreateTokenInput {
  name?: string;
  userId?: string;
  tier?: 'free' | 'starter' | 'pro' | 'enterprise';
  requestsPerMinute?: number;
  requestsPerDay?: number;
  monthlyRequestLimit?: number | null;
  monthlySettlementLimit?: number | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface TokenStorage {
  /**
   * Retrieve token by token string or hash
   * Returns null if not found or inactive
   */
  getToken(tokenOrHash: string): Promise<ApiToken | null>;

  /**
   * Create new API token
   * Generates token string automatically
   */
  createToken(input: CreateTokenInput, environment: 'test' | 'live'): Promise<ApiToken>;

  /**
   * Update token properties
   */
  updateToken(id: string, data: Partial<ApiToken>): Promise<ApiToken>;

  /**
   * Soft delete - set isActive = false
   */
  revokeToken(id: string): Promise<void>;

  /**
   * Update lastUsedAt timestamp
   */
  touchToken(id: string): Promise<void>;
}
```

### 2. RateLimiter Interface

**Purpose:** Track and enforce rate limits per token

```typescript
export interface RateLimitConfig {
  perMinute: number;
  perDay: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

export interface RateLimiter {
  /**
   * Check if request is within rate limits
   * Does NOT increment counter
   */
  check(tokenId: string, config: RateLimitConfig): Promise<RateLimitResult>;

  /**
   * Increment rate limit counter
   * Call after successful request
   */
  increment(tokenId: string): Promise<void>;

  /**
   * Get current usage stats
   */
  getUsage(tokenId: string): Promise<{
    currentMinute: number;
    currentDay: number;
  }>;

  /**
   * Reset rate limits (for testing or manual override)
   */
  reset(tokenId: string): Promise<void>;
}
```

### 3. UsageTracker Interface

**Purpose:** Log requests for analytics and billing

```typescript
export interface UsageRecord {
  tokenId: string;
  endpoint: string;                  // /verify, /settle, etc.
  method: string;                    // GET, POST

  // Payment details (optional)
  paymentScheme?: 'exact' | 'upto';
  paymentNetwork?: 'evm' | 'svm' | 'starknet';
  paymentAmount?: number;            // In token units
  settlementHash?: string;           // Blockchain tx hash
  gasUsed?: number;

  // Request context
  ipAddress?: string;
  userAgent?: string;

  // Response
  statusCode: number;
  success: boolean;
  errorMessage?: string;
  responseTimeMs: number;

  // Timestamp
  timestamp: Date;
}

export interface UsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalSettlementVolume: number;     // In USD/USDC
  totalGasCost: number;
  avgResponseTimeMs: number;
  requestsByEndpoint: Record<string, number>;
  requestsByNetwork: Record<string, number>;
}

export interface UsageTracker {
  /**
   * Log a request
   */
  track(record: UsageRecord): Promise<void>;

  /**
   * Get usage statistics for a period
   */
  getStats(
    tokenId: string,
    period: { start: Date; end: Date }
  ): Promise<UsageStats>;

  /**
   * Get recent requests (for debugging)
   */
  getRecentRequests(tokenId: string, limit?: number): Promise<UsageRecord[]>;
}
```

### 4. BearerTokenValidator

**Purpose:** Core authentication logic

```typescript
export interface AuthContext {
  tokenId: string;
  userId: string | null;
  tier: string;
  metadata: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  context?: AuthContext;
  error?: {
    code: 'MISSING_TOKEN' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'RATE_LIMITED' | 'INACTIVE_TOKEN';
    message: string;
    details?: Record<string, unknown>;
  };
}

export class BearerTokenValidator {
  constructor(
    private storage: TokenStorage,
    private rateLimiter: RateLimiter,
    private config: AuthConfig
  ) {}

  /**
   * Validate Authorization header
   * Returns ValidationResult with context or error
   */
  async validate(authHeader: string | null): Promise<ValidationResult>;

  /**
   * Extract bearer token from header
   */
  private extractToken(authHeader: string | null): string | null;

  /**
   * Validate token format
   */
  private isValidTokenFormat(token: string): boolean;
}
```

## TDD Implementation Flow

### Phase 1: Token Generation & Format

**Test Cases:**
```typescript
describe('Token Generation', () => {
  test('generates test environment token with correct prefix', () => {
    const token = generateToken('test');
    expect(token).toMatch(/^fac_test_[a-zA-Z0-9]{24}$/);
  });

  test('generates live environment token with correct prefix', () => {
    const token = generateToken('live');
    expect(token).toMatch(/^fac_live_[a-zA-Z0-9]{24}$/);
  });

  test('generates unique tokens on each call', () => {
    const token1 = generateToken('test');
    const token2 = generateToken('test');
    expect(token1).not.toBe(token2);
  });

  test('generates tokens with consistent length', () => {
    const token = generateToken('test');
    expect(token.length).toBe(33); // fac_test_ (9) + random (24)
  });
});

describe('Token Hashing', () => {
  test('generates consistent SHA256 hash for same token', () => {
    const token = 'fac_test_abc123';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
  });

  test('generates different hashes for different tokens', () => {
    const hash1 = hashToken('fac_test_abc123');
    const hash2 = hashToken('fac_test_xyz789');
    expect(hash1).not.toBe(hash2);
  });
});
```

**Implementation:**
```typescript
// src/auth/tokens.ts

import crypto from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function generateRandomString(length: number): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE58_ALPHABET[bytes[i] % BASE58_ALPHABET.length];
  }
  return result;
}

export function generateToken(environment: 'test' | 'live'): string {
  const random = generateRandomString(24);
  return `fac_${environment}_${random}`;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function validateTokenFormat(token: string): boolean {
  return /^fac_(test|live)_[a-zA-Z0-9]{24}$/.test(token);
}
```

### Phase 2: InMemoryTokenStorage

**Test Cases:**
```typescript
describe('InMemoryTokenStorage', () => {
  let storage: TokenStorage;

  beforeEach(() => {
    storage = new InMemoryTokenStorage();
  });

  test('creates token with generated token string', async () => {
    const token = await storage.createToken({
      name: 'Test Token',
      tier: 'free'
    }, 'test');

    expect(token.token).toMatch(/^fac_test_/);
    expect(token.name).toBe('Test Token');
    expect(token.tier).toBe('free');
    expect(token.isActive).toBe(true);
  });

  test('retrieves token by token string', async () => {
    const created = await storage.createToken({ name: 'Test' }, 'test');
    const retrieved = await storage.getToken(created.token);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
  });

  test('retrieves token by hash', async () => {
    const created = await storage.createToken({ name: 'Test' }, 'test');
    const retrieved = await storage.getToken(created.tokenHash);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
  });

  test('returns null for non-existent token', async () => {
    const token = await storage.getToken('fac_test_nonexistent');
    expect(token).toBeNull();
  });

  test('returns null for revoked token', async () => {
    const created = await storage.createToken({ name: 'Test' }, 'test');
    await storage.revokeToken(created.id);

    const retrieved = await storage.getToken(created.token);
    expect(retrieved).toBeNull();
  });

  test('updates token properties', async () => {
    const created = await storage.createToken({ name: 'Original' }, 'test');
    const updated = await storage.updateToken(created.id, {
      name: 'Updated',
      tier: 'pro'
    });

    expect(updated.name).toBe('Updated');
    expect(updated.tier).toBe('pro');
  });

  test('touches token updates lastUsedAt', async () => {
    const created = await storage.createToken({ name: 'Test' }, 'test');
    const before = created.lastUsedAt;

    await new Promise(resolve => setTimeout(resolve, 10));
    await storage.touchToken(created.id);

    const retrieved = await storage.getToken(created.token);
    expect(retrieved?.lastUsedAt).not.toBe(before);
  });

  test('enforces default rate limits', async () => {
    const token = await storage.createToken({}, 'test');

    expect(token.requestsPerMinute).toBe(100);
    expect(token.requestsPerDay).toBe(10000);
  });

  test('accepts custom rate limits', async () => {
    const token = await storage.createToken({
      requestsPerMinute: 500,
      requestsPerDay: 50000
    }, 'test');

    expect(token.requestsPerMinute).toBe(500);
    expect(token.requestsPerDay).toBe(50000);
  });
});
```

**Implementation:**
```typescript
// src/auth/storage/memory.ts

import { randomUUID } from 'node:crypto';
import { generateToken, hashToken } from '../tokens.js';
import type { ApiToken, CreateTokenInput, TokenStorage } from './interface.js';

export class InMemoryTokenStorage implements TokenStorage {
  private tokens = new Map<string, ApiToken>();

  async getToken(tokenOrHash: string): Promise<ApiToken | null> {
    // Try direct lookup by token
    let token = Array.from(this.tokens.values()).find(t => t.token === tokenOrHash);

    // Try lookup by hash
    if (!token) {
      token = Array.from(this.tokens.values()).find(t => t.tokenHash === tokenOrHash);
    }

    // Return null if inactive or not found
    if (!token || !token.isActive) {
      return null;
    }

    return token;
  }

  async createToken(input: CreateTokenInput, environment: 'test' | 'live'): Promise<ApiToken> {
    const id = randomUUID();
    const tokenString = generateToken(environment);
    const tokenHash = hashToken(tokenString);
    const now = new Date();

    const token: ApiToken = {
      id,
      token: tokenString,
      tokenHash,
      name: input.name || null,
      userId: input.userId || null,
      tier: input.tier || 'free',
      requestsPerMinute: input.requestsPerMinute || 100,
      requestsPerDay: input.requestsPerDay || 10000,
      monthlyRequestLimit: input.monthlyRequestLimit || null,
      monthlySettlementLimit: input.monthlySettlementLimit || null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt || null,
      lastUsedAt: null,
      metadata: input.metadata || {}
    };

    this.tokens.set(id, token);
    return token;
  }

  async updateToken(id: string, data: Partial<ApiToken>): Promise<ApiToken> {
    const token = this.tokens.get(id);
    if (!token) {
      throw new Error(`Token not found: ${id}`);
    }

    const updated = {
      ...token,
      ...data,
      id: token.id, // Prevent ID change
      token: token.token, // Prevent token change
      tokenHash: token.tokenHash, // Prevent hash change
      updatedAt: new Date()
    };

    this.tokens.set(id, updated);
    return updated;
  }

  async revokeToken(id: string): Promise<void> {
    await this.updateToken(id, { isActive: false });
  }

  async touchToken(id: string): Promise<void> {
    await this.updateToken(id, { lastUsedAt: new Date() });
  }
}
```

### Phase 3: InMemoryRateLimiter

**Test Cases:**
```typescript
describe('InMemoryRateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  test('allows requests within per-minute limit', async () => {
    const config = { perMinute: 5, perDay: 100 };

    for (let i = 0; i < 5; i++) {
      const result = await limiter.check('token-1', config);
      expect(result.allowed).toBe(true);
      await limiter.increment('token-1');
    }
  });

  test('blocks requests exceeding per-minute limit', async () => {
    const config = { perMinute: 3, perDay: 100 };

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      await limiter.increment('token-1');
    }

    // Should be blocked
    const result = await limiter.check('token-1', config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test('resets per-minute limit after window expires', async () => {
    const config = { perMinute: 2, perDay: 100 };

    // Use up the limit
    await limiter.increment('token-1');
    await limiter.increment('token-1');

    // Should be blocked
    let result = await limiter.check('token-1', config);
    expect(result.allowed).toBe(false);

    // Wait for window to expire (simulate time passing)
    await limiter.reset('token-1');

    // Should be allowed again
    result = await limiter.check('token-1', config);
    expect(result.allowed).toBe(true);
  });

  test('tracks daily usage independently', async () => {
    const config = { perMinute: 100, perDay: 5 };

    for (let i = 0; i < 5; i++) {
      const result = await limiter.check('token-1', config);
      expect(result.allowed).toBe(true);
      await limiter.increment('token-1');
    }

    // Daily limit exceeded
    const result = await limiter.check('token-1', config);
    expect(result.allowed).toBe(false);
  });

  test('provides accurate remaining count', async () => {
    const config = { perMinute: 10, perDay: 100 };

    await limiter.increment('token-1');
    await limiter.increment('token-1');

    const result = await limiter.check('token-1', config);
    expect(result.remaining).toBe(8); // 10 - 2
  });

  test('isolates rate limits per token', async () => {
    const config = { perMinute: 2, perDay: 100 };

    await limiter.increment('token-1');
    await limiter.increment('token-1');

    // token-1 is at limit
    const result1 = await limiter.check('token-1', config);
    expect(result1.allowed).toBe(false);

    // token-2 is not affected
    const result2 = await limiter.check('token-2', config);
    expect(result2.allowed).toBe(true);
  });
});
```

### Phase 4: InMemoryUsageTracker

**Test Cases:**
```typescript
describe('InMemoryUsageTracker', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new InMemoryUsageTracker();
  });

  test('tracks basic request', async () => {
    await tracker.track({
      tokenId: 'token-1',
      endpoint: '/verify',
      method: 'POST',
      statusCode: 200,
      success: true,
      responseTimeMs: 150,
      timestamp: new Date()
    });

    const recent = await tracker.getRecentRequests('token-1', 10);
    expect(recent).toHaveLength(1);
    expect(recent[0].endpoint).toBe('/verify');
  });

  test('calculates usage statistics', async () => {
    const now = new Date();

    await tracker.track({
      tokenId: 'token-1',
      endpoint: '/verify',
      method: 'POST',
      statusCode: 200,
      success: true,
      responseTimeMs: 100,
      timestamp: now
    });

    await tracker.track({
      tokenId: 'token-1',
      endpoint: '/settle',
      method: 'POST',
      statusCode: 200,
      success: true,
      responseTimeMs: 200,
      paymentAmount: 10,
      gasUsed: 0.5,
      timestamp: now
    });

    await tracker.track({
      tokenId: 'token-1',
      endpoint: '/verify',
      method: 'POST',
      statusCode: 400,
      success: false,
      errorMessage: 'Invalid signature',
      responseTimeMs: 50,
      timestamp: now
    });

    const stats = await tracker.getStats('token-1', {
      start: new Date(now.getTime() - 1000),
      end: new Date(now.getTime() + 1000)
    });

    expect(stats.totalRequests).toBe(3);
    expect(stats.successfulRequests).toBe(2);
    expect(stats.failedRequests).toBe(1);
    expect(stats.avgResponseTimeMs).toBe(116.67); // (100 + 200 + 50) / 3
    expect(stats.requestsByEndpoint['/verify']).toBe(2);
    expect(stats.requestsByEndpoint['/settle']).toBe(1);
  });

  test('filters by time period', async () => {
    const yesterday = new Date(Date.now() - 86400000);
    const today = new Date();

    await tracker.track({
      tokenId: 'token-1',
      endpoint: '/verify',
      method: 'POST',
      statusCode: 200,
      success: true,
      responseTimeMs: 100,
      timestamp: yesterday
    });

    await tracker.track({
      tokenId: 'token-1',
      endpoint: '/verify',
      method: 'POST',
      statusCode: 200,
      success: true,
      responseTimeMs: 100,
      timestamp: today
    });

    const stats = await tracker.getStats('token-1', {
      start: new Date(Date.now() - 3600000), // Last hour
      end: today
    });

    expect(stats.totalRequests).toBe(1);
  });

  test('limits recent requests', async () => {
    for (let i = 0; i < 20; i++) {
      await tracker.track({
        tokenId: 'token-1',
        endpoint: '/verify',
        method: 'POST',
        statusCode: 200,
        success: true,
        responseTimeMs: 100,
        timestamp: new Date()
      });
    }

    const recent = await tracker.getRecentRequests('token-1', 5);
    expect(recent).toHaveLength(5);
  });
});
```

### Phase 5: BearerTokenValidator

**Test Cases:**
```typescript
describe('BearerTokenValidator', () => {
  let validator: BearerTokenValidator;
  let storage: TokenStorage;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    storage = new InMemoryTokenStorage();
    rateLimiter = new InMemoryRateLimiter();
    validator = new BearerTokenValidator(storage, rateLimiter, {
      enabled: true
    });
  });

  test('validates valid bearer token', async () => {
    const token = await storage.createToken({ name: 'Test' }, 'test');

    const result = await validator.validate(`Bearer ${token.token}`);

    expect(result.valid).toBe(true);
    expect(result.context?.tokenId).toBe(token.id);
  });

  test('rejects missing authorization header', async () => {
    const result = await validator.validate(null);

    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('MISSING_TOKEN');
  });

  test('rejects malformed authorization header', async () => {
    const result = await validator.validate('InvalidHeader');

    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_TOKEN');
  });

  test('rejects non-existent token', async () => {
    const result = await validator.validate('Bearer fac_test_nonexistent123');

    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_TOKEN');
  });

  test('rejects expired token', async () => {
    const token = await storage.createToken({
      name: 'Test',
      expiresAt: new Date(Date.now() - 1000) // Expired 1 second ago
    }, 'test');

    const result = await validator.validate(`Bearer ${token.token}`);

    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('EXPIRED_TOKEN');
  });

  test('rejects rate-limited token', async () => {
    const token = await storage.createToken({
      requestsPerMinute: 2
    }, 'test');

    // Use up the rate limit
    await rateLimiter.increment(token.id);
    await rateLimiter.increment(token.id);

    const result = await validator.validate(`Bearer ${token.token}`);

    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('RATE_LIMITED');
  });

  test('updates lastUsedAt on successful validation', async () => {
    const token = await storage.createToken({ name: 'Test' }, 'test');

    await validator.validate(`Bearer ${token.token}`);

    const updated = await storage.getToken(token.token);
    expect(updated?.lastUsedAt).not.toBeNull();
  });

  test('extracts token from Bearer prefix case-insensitive', async () => {
    const token = await storage.createToken({ name: 'Test' }, 'test');

    const result1 = await validator.validate(`Bearer ${token.token}`);
    const result2 = await validator.validate(`bearer ${token.token}`);
    const result3 = await validator.validate(`BEARER ${token.token}`);

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
    expect(result3.valid).toBe(true);
  });
});
```

### Phase 6: Auth Middleware Core

**Test Cases:**
```typescript
describe('Auth Middleware Core', () => {
  let storage: TokenStorage;
  let validator: BearerTokenValidator;
  let tracker: UsageTracker;

  beforeEach(() => {
    storage = new InMemoryTokenStorage();
    const rateLimiter = new InMemoryRateLimiter();
    validator = new BearerTokenValidator(storage, rateLimiter, { enabled: true });
    tracker = new InMemoryUsageTracker();
  });

  test('authenticates request with valid token', async () => {
    const token = await storage.createToken({ name: 'Test' }, 'test');

    const mockRequest = {
      headers: { authorization: `Bearer ${token.token}` }
    };

    const result = await authenticateRequest(mockRequest, validator, tracker);

    expect(result.authorized).toBe(true);
    expect(result.context).toBeDefined();
  });

  test('rejects request without token', async () => {
    const mockRequest = {
      headers: {}
    };

    const result = await authenticateRequest(mockRequest, validator, tracker);

    expect(result.authorized).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('tracks successful authentication', async () => {
    const token = await storage.createToken({ name: 'Test' }, 'test');

    const mockRequest = {
      headers: { authorization: `Bearer ${token.token}` },
      method: 'POST',
      url: '/verify'
    };

    await authenticateRequest(mockRequest, validator, tracker);

    const recent = await tracker.getRecentRequests(token.id, 10);
    expect(recent.length).toBeGreaterThan(0);
  });

  test('tracks failed authentication', async () => {
    const mockRequest = {
      headers: { authorization: 'Bearer invalid_token' },
      method: 'POST',
      url: '/verify'
    };

    await authenticateRequest(mockRequest, validator, tracker);

    // Should log failed attempt (implementation specific)
  });
});
```

### Phase 7: Framework Middleware Wrappers

**Test Cases (Elysia):**
```typescript
describe('Elysia Auth Middleware', () => {
  test('adds auth context to successful request', async () => {
    const storage = new InMemoryTokenStorage();
    const token = await storage.createToken({ name: 'Test' }, 'test');

    const app = new Elysia()
      .use(createAuthPlugin({ storage }))
      .get('/protected', (ctx) => {
        return { userId: ctx.auth.userId };
      });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: { authorization: `Bearer ${token.token}` }
      })
    );

    expect(response.status).toBe(200);
  });

  test('returns 401 for missing token', async () => {
    const storage = new InMemoryTokenStorage();

    const app = new Elysia()
      .use(createAuthPlugin({ storage }))
      .get('/protected', () => 'OK');

    const response = await app.handle(
      new Request('http://localhost/protected')
    );

    expect(response.status).toBe(401);
  });

  test('allows bypassing auth when disabled', async () => {
    const app = new Elysia()
      .use(createAuthPlugin({ enabled: false }))
      .get('/protected', () => 'OK');

    const response = await app.handle(
      new Request('http://localhost/protected')
    );

    expect(response.status).toBe(200);
  });
});
```

## Integration Plan

### 1. Direct Endpoints (`app.ts`)

```typescript
// src/app.ts

import { createAuthPlugin } from './auth/middleware/elysia.js';
import { createAuthConfig } from './auth/config.js';

const authConfig = createAuthConfig();
const authPlugin = createAuthPlugin(authConfig);

const app = new Elysia()
  .use(logger)
  .use(authPlugin)  // Add auth before routes
  .post('/verify', verifyHandler)
  .post('/settle', settleHandler)
  .get('/supported', supportedHandler);
```

### 2. Framework Middleware (User's App)

**Elysia:**
```typescript
import { createElysiaPaymentMiddleware } from '@daydreamsai/facilitator/elysia';
import { createAuthPlugin } from '@daydreamsai/facilitator/auth/elysia';

app
  .use(createAuthPlugin({ ... }))              // Auth first
  .use(createElysiaPaymentMiddleware({ ... })) // Then payment
  .get('/resource', handler);
```

**Hono:**
```typescript
import { createHonoPaymentMiddleware } from '@daydreamsai/facilitator/hono';
import { createAuthMiddleware } from '@daydreamsai/facilitator/auth/hono';

app.use('*', createAuthMiddleware({ ... }));
app.use('*', createHonoPaymentMiddleware({ ... }));
app.get('/resource', handler);
```

**Express:**
```typescript
import { createExpressPaymentMiddleware } from '@daydreamsai/facilitator/express';
import { createAuthMiddleware } from '@daydreamsai/facilitator/auth/express';

app.use(createAuthMiddleware({ ... }));
app.use(createExpressPaymentMiddleware({ ... }));
app.get('/resource', handler);
```

## Migration to Production Storage

### PostgreSQL Adapter

```typescript
// src/auth/storage/postgres.ts

import { Pool } from 'pg';
import type { TokenStorage } from './interface.js';

export class PostgresTokenStorage implements TokenStorage {
  constructor(private pool: Pool) {}

  async getToken(tokenOrHash: string): Promise<ApiToken | null> {
    const result = await this.pool.query(
      `SELECT * FROM api_tokens
       WHERE (token = $1 OR token_hash = $1)
       AND is_active = true`,
      [tokenOrHash]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  // ... implement other methods
}
```

### Redis Adapter (for caching)

```typescript
// src/auth/storage/redis.ts

import { Redis } from 'ioredis';
import type { TokenStorage } from './interface.js';

export class CachedTokenStorage implements TokenStorage {
  constructor(
    private primary: TokenStorage,  // PostgreSQL
    private cache: Redis
  ) {}

  async getToken(tokenOrHash: string): Promise<ApiToken | null> {
    // Try cache first
    const cached = await this.cache.get(`token:${tokenOrHash}`);
    if (cached) return JSON.parse(cached);

    // Fallback to primary storage
    const token = await this.primary.getToken(tokenOrHash);

    // Cache for 5 minutes
    if (token) {
      await this.cache.setex(
        `token:${tokenOrHash}`,
        300,
        JSON.stringify(token)
      );
    }

    return token;
  }

  // ... implement other methods
}
```

### Factory Pattern for Easy Swapping

```typescript
// src/auth/factory.ts

export interface AuthStorageConfig {
  type: 'memory' | 'postgres' | 'cached';
  postgres?: {
    url: string;
    pool?: { min: number; max: number };
  };
  redis?: {
    url: string;
  };
}

export function createTokenStorage(config: AuthStorageConfig): TokenStorage {
  switch (config.type) {
    case 'memory':
      return new InMemoryTokenStorage();

    case 'postgres':
      const pool = new Pool({
        connectionString: config.postgres!.url,
        ...config.postgres?.pool
      });
      return new PostgresTokenStorage(pool);

    case 'cached':
      const pgPool = new Pool({
        connectionString: config.postgres!.url
      });
      const redis = new Redis(config.redis!.url);
      return new CachedTokenStorage(
        new PostgresTokenStorage(pgPool),
        redis
      );

    default:
      throw new Error(`Unknown storage type: ${config.type}`);
  }
}
```

## Configuration

### Environment Variables

```env
# Authentication
AUTH_ENABLED=true
AUTH_STORAGE_TYPE=memory  # memory | postgres | cached

# PostgreSQL (if using postgres or cached)
DATABASE_URL=postgresql://user:password@localhost:5432/facilitator

# Redis (if using cached)
REDIS_URL=redis://localhost:6379

# Rate Limiting
RATE_LIMIT_ENABLED=true

# Usage Tracking
USAGE_TRACKING_ENABLED=true
```

### Config File

```typescript
// src/auth/config.ts

import { config as loadEnv } from 'dotenv';

loadEnv();

export interface AuthConfig {
  enabled: boolean;
  storage: {
    type: 'memory' | 'postgres' | 'cached';
    postgres?: {
      url: string;
    };
    redis?: {
      url: string;
    };
  };
  rateLimiting: {
    enabled: boolean;
  };
  tracking: {
    enabled: boolean;
  };
}

export function createAuthConfig(): AuthConfig {
  return {
    enabled: process.env.AUTH_ENABLED === 'true',
    storage: {
      type: (process.env.AUTH_STORAGE_TYPE as any) || 'memory',
      postgres: process.env.DATABASE_URL
        ? { url: process.env.DATABASE_URL }
        : undefined,
      redis: process.env.REDIS_URL
        ? { url: process.env.REDIS_URL }
        : undefined
    },
    rateLimiting: {
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false'
    },
    tracking: {
      enabled: process.env.USAGE_TRACKING_ENABLED !== 'false'
    }
  };
}
```

## File Structure

```
src/auth/
├── index.ts                      # Public exports
├── config.ts                     # Configuration
├── tokens.ts                     # Token generation & hashing
├── validator.ts                  # BearerTokenValidator class
├── factory.ts                    # Storage factory
│
├── storage/
│   ├── interface.ts              # TokenStorage interface
│   ├── memory.ts                 # InMemoryTokenStorage
│   ├── postgres.ts               # PostgresTokenStorage (future)
│   └── redis.ts                  # CachedTokenStorage (future)
│
├── rate-limit/
│   ├── interface.ts              # RateLimiter interface
│   ├── memory.ts                 # InMemoryRateLimiter
│   └── redis.ts                  # RedisRateLimiter (future)
│
├── tracking/
│   ├── interface.ts              # UsageTracker interface
│   ├── memory.ts                 # InMemoryUsageTracker
│   └── postgres.ts               # PostgresUsageTracker (future)
│
└── middleware/
    ├── core.ts                   # Framework-agnostic logic
    ├── elysia.ts                 # Elysia plugin
    ├── hono.ts                   # Hono middleware
    └── express.ts                # Express middleware

tests/auth/
├── tokens.test.ts
├── storage/
│   └── memory.test.ts
├── rate-limit/
│   └── memory.test.ts
├── tracking/
│   └── memory.test.ts
├── validator.test.ts
└── middleware/
    ├── core.test.ts
    ├── elysia.test.ts
    ├── hono.test.ts
    └── express.test.ts
```

## Dependencies

**No new dependencies required for Phase 1 (in-memory)!**

All functionality uses Node.js built-ins:
- `crypto` - Token generation, hashing
- `randomUUID` - Token IDs

**Future dependencies (production storage):**
```json
{
  "dependencies": {
    "pg": "^8.11.0",           // PostgreSQL client
    "ioredis": "^5.3.0"        // Redis client
  },
  "devDependencies": {
    "@types/pg": "^8.10.0"
  }
}
```

## Success Criteria

### Phase 1 (In-Memory Implementation)
- [ ] All tests pass (100% coverage)
- [ ] Token generation with correct format
- [ ] InMemoryTokenStorage fully functional
- [ ] InMemoryRateLimiter enforces limits
- [ ] InMemoryUsageTracker logs requests
- [ ] BearerTokenValidator validates tokens
- [ ] Middleware works with Elysia, Hono, Express
- [ ] Can protect `/verify` and `/settle` endpoints
- [ ] Auth can be enabled/disabled via config

### Phase 2 (Production Storage)
- [ ] PostgreSQL adapter implements TokenStorage
- [ ] Redis adapter implements RateLimiter
- [ ] PostgreSQL adapter implements UsageTracker
- [ ] CachedTokenStorage combines Postgres + Redis
- [ ] Can swap storage via environment variable
- [ ] Migration scripts for database setup
- [ ] Performance benchmarks (< 5ms auth overhead)

## Next Steps

1. **Review this plan** - Confirm approach and design
2. **Set up test infrastructure** - Configure Bun test runner
3. **Start TDD cycle** - Begin with token generation tests
4. **Implement in order** - Follow phases 1-7
5. **Integration testing** - Test with actual facilitator endpoints
6. **Documentation** - Update README with auth setup
7. **Production adapters** - Build PostgreSQL/Redis when ready

---

**Estimated Timeline:**
- Phase 1 (In-Memory): ~4-6 hours of implementation
- Phase 2 (Production Storage): ~3-4 hours
- Total: ~7-10 hours with comprehensive testing

**Risk Mitigation:**
- TDD ensures correctness at each step
- In-memory first reduces complexity
- Interface-driven design makes swapping easy
- No breaking changes to existing code
