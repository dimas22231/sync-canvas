/**
 * Entry point server SyncCanvas.
 *
 * Urutan bootstrap sengaja eksplisit:
 * 1. Validasi env (fail fast).
 * 2. Susun dependency (RoomService) sekali, lalu inject ke HTTP & Socket.io.
 * 3. Mulai menerima koneksi.
 * 4. Pasang graceful shutdown agar deploy tidak memutus paksa koneksi aktif.
 */
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { RoomService } from './services/room.service.js';
import { createSocketServer } from './socket/index.js';

async function bootstrap(): Promise<void> {
  const logger = createLogger(env.logLevel, { service: 'synccanvas-server' });

  const rooms = new RoomService({
    maxRooms: env.maxRooms,
    maxMembersPerRoom: env.maxRoomMembers,
    maxStrokesPerRoom: env.maxStrokesPerRoom,
    idleTtlMs: env.roomIdleTtlMs,
  });

  const app = createApp({ rooms });
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer, { rooms, logger });

  // Room kosong dibersihkan berkala agar memori tidak tumbuh tanpa batas.
  const sweepTimer = setInterval(() => {
    const removed = rooms.sweepIdleRooms();
    if (removed > 0) logger.debug('Room idle dibersihkan', { removed });
  }, env.roomSweepIntervalMs);
  sweepTimer.unref();

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    httpServer.once('error', onError);
    httpServer.listen(env.port, () => {
      httpServer.off('error', onError);
      resolve();
    });
  });

  logger.info('Server siap menerima koneksi', {
    port: env.port,
    env: env.nodeEnv,
    corsOrigins: env.corsOrigins,
  });

  let isShuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Graceful shutdown dimulai', { signal });
    clearInterval(sweepTimer);

    // Jangan biarkan koneksi yang macet menahan deploy selamanya.
    const forceExitTimer = setTimeout(() => {
      logger.error('Shutdown dipaksa setelah 10 detik');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    // `io.close` memutus semua socket sekaligus menutup HTTP server.
    io.close(() => {
      clearTimeout(forceExitTimer);
      logger.info('Shutdown selesai');
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Bootstrap gagal',
      error: error instanceof Error ? error.stack : String(error),
    }),
  );
  process.exit(1);
});
