import { mkdirSync } from 'node:fs';

// PGlite membuat direktori database-nya sendiri, tetapi tidak membuat parent
// directory. Pastikan `.data/` ada sebelum pglite-server dijalankan.
mkdirSync('.data', { recursive: true });
