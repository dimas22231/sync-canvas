import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const FALLBACK_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/synccanvas';

function resolveConnectionString(): string {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) {
    return configured;
  }

  // Jangan connect saat build. postgres.js baru membuka koneksi pada query
  // pertama, sehingga fallback ini aman dipakai untuk evaluasi module.
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      '[db] DATABASE_URL belum di-set. Jalankan `npm run dev:local` atau isi DATABASE_URL.',
    );
  }
  return FALLBACK_DATABASE_URL;
}

const globalForDb = globalThis as unknown as {
  __synccanvasSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__synccanvasSql ??
  postgres(resolveConnectionString(), {
    // PGlite TCP multiplexer paling stabil dengan satu koneksi per proses.
    // Di produksi (Neon) nilai ini juga cukup untuk beban MVP.
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });

// Cache koneksi saat development agar HMR tidak membuka pool baru terus-menerus.
if (process.env.NODE_ENV !== 'production') {
  globalForDb.__synccanvasSql = sql;
}

export const db = drizzle(sql, { schema });

export { schema };
export * from './schema.js';

export type Database = typeof db;
