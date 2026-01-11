/**
 * Redis-backed Upto Session Store (Write-Through Cache Pattern)
 *
 * Implements the SYNCHRONOUS UptoSessionStore interface using:
 * - In-memory Map for fast, synchronous reads (hot path)
 * - Redis for durability and crash recovery (background writes)
 *
 * Pattern: Write-through cache
 * - Reads: Always from memory (sync, fast)
 * - Writes: Memory first, then Redis (async, non-blocking)
 * - Startup: Hydrate memory from Redis once
 *
 * This keeps the core library synchronous while adding persistence.
 *
 * @example
 * ```typescript
 * import { RedisSessionStore } from "./upto/redisStore";
 *
 * const redisUrl = process.env.REDIS_URL!;
 * const redisStore = new RedisSessionStore(redisUrl);
 * await redisStore.connect(); // Hydrates from Redis
 *
 * // Use with createUptoModule - sync interface!
 * const upto = createUptoModule({
 *   store: redisStore,
 *   facilitatorClient,
 * });
 * ```
 */

import type {
  UptoSessionStore,
  UptoSession,
} from "@daydreamsai/facilitator/upto";
import { createClient, type RedisClientType } from "redis";

/**
 * Serializable version of UptoSession for JSON storage.
 * BigInt values are converted to strings for JSON compatibility.
 */
interface SerializedUptoSession {
  cap: string;
  deadline: string;
  pendingSpent: string;
  settledTotal: string;
  lastActivityMs: number;
  status: UptoSession["status"];
  paymentPayload: UptoSession["paymentPayload"];
  paymentRequirements: UptoSession["paymentRequirements"];
  lastSettlement?: UptoSession["lastSettlement"];
}

/**
 * Convert UptoSession to a JSON-serializable format.
 */
function serializeSession(session: UptoSession): string {
  const serialized: SerializedUptoSession = {
    cap: session.cap.toString(),
    deadline: session.deadline.toString(),
    pendingSpent: session.pendingSpent.toString(),
    settledTotal: session.settledTotal.toString(),
    lastActivityMs: session.lastActivityMs,
    status: session.status,
    paymentPayload: session.paymentPayload,
    paymentRequirements: session.paymentRequirements,
    lastSettlement: session.lastSettlement,
  };
  return JSON.stringify(serialized);
}

/**
 * Restore UptoSession from serialized JSON format.
 */
function deserializeSession(json: string): UptoSession {
  const data = JSON.parse(json) as SerializedUptoSession;
  return {
    cap: BigInt(data.cap),
    deadline: BigInt(data.deadline),
    pendingSpent: BigInt(data.pendingSpent),
    settledTotal: BigInt(data.settledTotal),
    lastActivityMs: data.lastActivityMs,
    status: data.status,
    paymentPayload: data.paymentPayload,
    paymentRequirements: data.paymentRequirements,
    lastSettlement: data.lastSettlement,
  };
}

/**
 * Redis-backed session store using write-through cache pattern.
 *
 * - Implements SYNC UptoSessionStore interface (no async in hot path)
 * - Uses in-memory Map for all reads (fast)
 * - Writes to Redis in background (durability)
 * - Hydrates from Redis on connect (crash recovery)
 */
export class RedisSessionStore implements UptoSessionStore {
  /** In-memory cache - source of truth for reads */
  private readonly memory = new Map<string, UptoSession>();

  /** Redis client for persistence */
  private client: RedisClientType;

  /** Key prefix in Redis */
  private prefix: string;

  /** Track if connected and hydrated */
  private connected = false;

  /**
   * Create a new Redis session store.
   *
   * @param redisUrl - Redis connection URL (e.g., redis://user:pass@host:port)
   * @param prefix - Key prefix for session keys (default: "upto:")
   */
  constructor(redisUrl: string, prefix = "upto:") {
    this.client = createClient({ url: redisUrl });
    this.prefix = prefix;

    // Handle connection errors (log but don't crash - memory still works)
    this.client.on("error", (err: Error) => {
      console.error("Redis Client Error:", err.message);
    });
  }

  /**
   * Connect to Redis and hydrate memory from persisted sessions.
   * Must be called before using the store.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      await this.client.connect();
      console.log("✅ Redis connected, hydrating sessions...");

      // Hydrate memory from Redis
      await this.hydrate();

      this.connected = true;
      console.log(`✅ Hydrated ${this.memory.size} sessions from Redis`);
    } catch (err) {
      console.error("⚠️  Redis connection failed, using memory-only mode:", err);
      // Continue without Redis - memory store still works
      this.connected = false;
    }
  }

  /**
   * Load all sessions from Redis into memory.
   */
  private async hydrate(): Promise<void> {
    let cursor = 0;

    do {
      const result = await this.client.scan(cursor, {
        MATCH: `${this.prefix}*`,
        COUNT: 100,
      });

      cursor = result.cursor;

      if (result.keys.length > 0) {
        const values = await this.client.mGet(result.keys);

        for (let i = 0; i < result.keys.length; i++) {
          const key = result.keys[i];
          const raw = values[i];

          if (!key || !raw) continue;

          try {
            const id = key.slice(this.prefix.length);
            const session = deserializeSession(raw);
            this.memory.set(id, session);
          } catch (err) {
            console.warn(`Failed to deserialize session ${key}:`, err);
          }
        }
      }
    } while (cursor !== 0);
  }

  /**
   * Disconnect from Redis.
   */
  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.disconnect();
      console.log("Redis session store disconnected");
    }
  }

  /**
   * Get the full Redis key for a session ID.
   */
  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  // =========================================================================
  // UptoSessionStore interface (SYNC methods)
  // =========================================================================

  /**
   * Get a session by ID (SYNC - reads from memory).
   */
  get(id: string): UptoSession | undefined {
    return this.memory.get(id);
  }

  /**
   * Set (create or update) a session (SYNC - writes to memory, async to Redis).
   */
  set(id: string, session: UptoSession): void {
    // Write to memory first (sync, fast)
    this.memory.set(id, session);

    // Write-through to Redis (async, fire-and-forget)
    if (this.client.isOpen) {
      this.client
        .set(this.key(id), serializeSession(session))
        .catch((err: Error) => {
          console.error(`Redis SET failed for ${id}:`, err.message);
        });
    }
  }

  /**
   * Delete a session (SYNC - deletes from memory, async from Redis).
   */
  delete(id: string): void {
    // Delete from memory first (sync, fast)
    this.memory.delete(id);

    // Delete from Redis (async, fire-and-forget)
    if (this.client.isOpen) {
      this.client.del(this.key(id)).catch((err: Error) => {
        console.error(`Redis DEL failed for ${id}:`, err.message);
      });
    }
  }

  /**
   * Iterate over all sessions (SYNC - iterates memory).
   */
  entries(): IterableIterator<[string, UptoSession]> {
    return this.memory.entries();
  }

  // =========================================================================
  // Additional helpers
  // =========================================================================

  /**
   * Get the number of sessions in memory.
   */
  get size(): number {
    return this.memory.size;
  }

  /**
   * Check if Redis is connected.
   */
  get isConnected(): boolean {
    return this.connected && this.client.isOpen;
  }

  /**
   * Force sync a specific session to Redis (for critical updates).
   * Returns a promise so caller can await if needed.
   */
  async syncToRedis(id: string): Promise<void> {
    const session = this.memory.get(id);
    if (!session || !this.client.isOpen) return;

    await this.client.set(this.key(id), serializeSession(session));
  }

  /**
   * Force sync all sessions to Redis.
   * Useful before graceful shutdown.
   */
  async syncAllToRedis(): Promise<void> {
    if (!this.client.isOpen) return;

    const promises: Promise<unknown>[] = [];
    for (const [id, session] of this.memory.entries()) {
      promises.push(
        this.client.set(this.key(id), serializeSession(session))
      );
    }

    await Promise.all(promises);
    console.log(`✅ Synced ${promises.length} sessions to Redis`);
  }
}
