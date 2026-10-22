/**
 * Konfigurasi & bootstrap Socket.io.
 *
 * Catatan arsitektur:
 * - Satu instance = satu sumber kebenaran (in-memory). Untuk horizontal
 *   scaling, tambahkan `@socket.io/redis-adapter` + sticky sessions di load
 *   balancer dan pindahkan RoomService ke Redis/Postgres.
 * - Autentikasi belum diimplementasikan. Titik integrasinya: `io.use()`
 *   sebelum `connection`, verifikasi JWT dari `socket.handshake.auth.token`,
 *   lalu isi `socket.data.userId` dengan identity dari token (bukan random).
 */
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import type { RoomService } from '../services/room.service.js';
import type { SyncServer } from '../types.js';
import { registerRoomHandlers } from './handlers/room.handler.js';
import { registerStrokeHandlers } from './handlers/stroke.handler.js';
import { registerCursorHandlers } from './handlers/cursor.handler.js';
import { installRateLimiter } from './middleware/rate-limit.js';

export interface SocketServerDeps {
  rooms: RoomService;
  logger: Logger;
}

export function createSocketServer(httpServer: HttpServer, deps: SocketServerDeps): SyncServer {
  const { logger } = deps;

  const io: SyncServer = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // WebSocket diutamakan; polling tersedia sebagai fallback untuk jaringan
    // korporat yang memblokir upgrade.
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    // Batas payload ~1 MB; batch titik normalnya hanya beberapa KB.
    maxHttpBufferSize: 1_000_000,
  });

  io.engine.on('connection_error', (error) => {
    logger.warn('Socket connection error', {
      code: error.code,
      message: error.message,
      context: error.context,
    });
  });

  io.on('connection', (socket) => {
    // Identitas sementara. Ganti dengan hasil verifikasi JWT di produksi.
    socket.data.userId = randomUUID();
    socket.data.roomId = null;
    installRateLimiter(socket);

    logger.debug('Socket terhubung', {
      socketId: socket.id,
      origin: socket.handshake.headers.origin,
      transport: socket.conn.transport.name,
    });

    registerRoomHandlers(io, socket, deps);
    registerStrokeHandlers(socket, deps);
    registerCursorHandlers(socket, logger);

    // Error transport (bukan error handler aplikasi) — cukup dicatat.
    socket.on('error', (error) => {
      logger.warn('Socket error', { socketId: socket.id, error });
    });
  });

  return io;
}
