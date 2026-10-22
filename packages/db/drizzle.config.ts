import { defineConfig } from 'drizzle-kit';

/**
 * Konfigurasi ini hanya dipakai untuk *generate* SQL migration.
 * Aplikasi menerapkan migration lewat `src/migrate.ts` agar driver yang sama
 * (postgres.js) dipakai di lokal (PGlite TCP) maupun Neon.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
