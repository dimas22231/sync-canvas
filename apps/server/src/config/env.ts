/**
 * Konfigurasi terpusat yang divalidasi saat bootstrap.
 *
 * Mengapa tidak membaca `process.env` langsung di banyak file?
 * - Gagal cepat (fail fast) jika ada env yang salah/typo.
 * - Tipe sudah pasti (number, union literal) tanpa cast di call site.
 * - Mudah di-mock pada test karena seluruh dependensi env lewat satu modul.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Daftar origin dipisah koma; `*` hanya untuk eksperimen lokal. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  MAX_ROOMS: z.coerce.number().int().positive().default(500),
  MAX_ROOM_MEMBERS: z.coerce.number().int().positive().default(50),
  MAX_STROKES_PER_ROOM: z.coerce.number().int().positive().default(2000),
  ROOM_IDLE_TTL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(30 * 60_000),
  ROOM_SWEEP_INTERVAL_MS: z.coerce.number().int().min(1_000).default(60_000),

  RATE_LIMIT_CURSOR_PER_SEC: z.coerce.number().positive().default(60),
  RATE_LIMIT_WRITE_PER_SEC: z.coerce.number().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => ({
    variable: issue.path.join('.'),
    message: issue.message,
  }));
  // Logger belum bisa dipakai karena env belum valid — gunakan console.
  console.error('[config] Environment variable tidak valid:', JSON.stringify(issues, null, 2));
  process.exit(1);
}

const raw = parsed.data;

/**
 * Env yang sudah dinormalisasi (camelCase, number, array).
 * `Object.freeze` mencegah mutasi tak sengaja dari modul lain.
 */
export const env = Object.freeze({
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  maxRooms: raw.MAX_ROOMS,
  maxRoomMembers: raw.MAX_ROOM_MEMBERS,
  maxStrokesPerRoom: raw.MAX_STROKES_PER_ROOM,
  roomIdleTtlMs: raw.ROOM_IDLE_TTL_MS,
  roomSweepIntervalMs: raw.ROOM_SWEEP_INTERVAL_MS,
  rateLimitCursorPerSec: raw.RATE_LIMIT_CURSOR_PER_SEC,
  rateLimitWritePerSec: raw.RATE_LIMIT_WRITE_PER_SEC,
});

export type AppEnv = typeof env;
