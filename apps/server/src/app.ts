/**
 * Express hanya dipakai untuk health check dan (nanti) REST ringan
 * (auth, daftar room, undangan). Trafik whiteboard sepenuhnya lewat WebSocket.
 */
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { env } from './config/env.js';
import type { RoomService } from './services/room.service.js';

export interface AppDeps {
  rooms: RoomService;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '32kb' }));

  /** Liveness: proses hidup dan event loop responsif. */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  /** Readiness + metrik ringan (tanpa isi board / data pribadi). */
  app.get('/ready', (_req: Request, res: Response) => {
    res.json({
      status: 'ready',
      rooms: deps.rooms.getStats(),
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' },
    });
  });

  // Express mengenali error handler dari arity 4 parameter.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ level: 'error', message: 'HTTP error', detail: message }));
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' },
    });
  });

  return app;
}
