import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error(
    '[db] DATABASE_URL wajib di-set untuk menjalankan migration. ' +
      'Untuk lokal gunakan `npm run dev:local` dari root repo.',
  );
  process.exit(1);
}

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => undefined,
});

try {
  await migrate(drizzle(sql), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log('[db] Migration selesai.');
} catch (error) {
  console.error('[db] Migration gagal:', error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
