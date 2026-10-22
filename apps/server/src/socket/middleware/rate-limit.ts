/**
 * Rate limiting per socket menggunakan token bucket.
 *
 * Dua budget dipisah karena karakteristik trafiknya berbeda:
 * - `cursor`: sangat sering, tetapi murah (tidak disimpan, hanya relay).
 * - `write`: lebih jarang, mengubah state board.
 *
 * Budget disimpan di WeakMap agar otomatis hilang saat socket di-GC, tanpa
 * perlu hook disconnect dan tanpa risiko memory leak.
 */
import { env } from '../../config/env.js';
import { TokenBucket } from '../../lib/token-bucket.js';
import type { SyncSocket } from '../../types.js';

export type BudgetKind = 'cursor' | 'write';

const budgets = new WeakMap<SyncSocket, Record<BudgetKind, TokenBucket>>();

/** Dipanggil sekali saat koneksi dibuat. */
export function installRateLimiter(socket: SyncSocket): void {
  budgets.set(socket, {
    cursor: new TokenBucket({
      capacity: env.rateLimitCursorPerSec,
      refillPerSecond: env.rateLimitCursorPerSec,
    }),
    write: new TokenBucket({
      capacity: env.rateLimitWritePerSec,
      refillPerSecond: env.rateLimitWritePerSec,
    }),
  });
}

/**
 * Mengambil budget. `true` = boleh diproses.
 * Socket tanpa limiter (mis. test unit) dianggap selalu boleh.
 */
export function consumeBudget(socket: SyncSocket, kind: BudgetKind, cost = 1): boolean {
  const bucket = budgets.get(socket);
  if (!bucket) return true;
  return bucket[kind].consume(cost);
}
