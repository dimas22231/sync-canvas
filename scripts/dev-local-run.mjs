import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Dijalankan oleh pglite-server setelah database siap.
 * pglite-server men-spawn command secara langsung (tanpa shell), sehingga di
 * Windows `npm` tidak bisa dieksekusi dan operator `&&` tidak dikenali. Skrip
 * ini menjalankan migration lalu dev server secara berurutan lewat shell.
 */
function run(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(`${npmCommand} ${command}`, {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });

    const forward = (signal) => {
      child.kill(signal);
    };
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);

      if (signal) {
        reject(new Error(`Perintah "${command}" berhenti karena sinyal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Perintah "${command}" gagal dengan exit code ${code ?? 'unknown'}.`));
        return;
      }

      resolve();
    });
  });
}

try {
  await run('run db:migrate');
  await run('run dev:apps');
} catch (error) {
  console.error(`[dev:local] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
