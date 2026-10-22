/**
 * Token bucket sederhana untuk rate limiting per socket.
 *
 * Dipilih dibanding fixed window karena:
 * - Tidak ada lonjakan di batas window ("burst at boundary").
 * - Murah secara komputasi (satu objek per socket, tanpa timer).
 *
 * Contoh: kapasitas 60, refill 60/detik -> rata-rata 60 event/detik
 * dengan toleransi burst singkat hingga 60 event.
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(private readonly options: TokenBucketOptions) {
    if (options.capacity <= 0 || options.refillPerSecond <= 0) {
      throw new Error('TokenBucket: capacity dan refillPerSecond harus > 0');
    }
    this.tokens = options.capacity;
    this.lastRefillAt = Date.now();
  }

  /** Mengambil token; `false` berarti permintaan harus ditolak. */
  consume(cost = 1): boolean {
    if (cost <= 0) return true;
    this.refill();

    if (this.tokens < cost) return false;

    this.tokens -= cost;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillAt) / 1000;
    if (elapsedSeconds <= 0) return;

    this.tokens = Math.min(
      this.options.capacity,
      this.tokens + elapsedSeconds * this.options.refillPerSecond,
    );
    this.lastRefillAt = now;
  }
}
