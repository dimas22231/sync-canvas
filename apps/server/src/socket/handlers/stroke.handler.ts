/**
 * Handler streaming stroke.
 *
 * Model konsistensi:
 * - Pengirim melakukan optimistic update, jadi server *tidak* meng-echo
 *   `stroke:started/appended/ended` ke socket pengirim.
 * - Peserta lain menerima event secara berurutan (TCP) sehingga urutan
 *   `start -> points* -> end` selalu terjaga.
 * - `stroke:points` dikirim dengan `volatile`: jika buffer jaringan penuh,
 *   paket lama boleh dibuang. Titik-titik berikutnya tetap membuat garis
 *   terlihat kontinu, dan lebih baik kehilangan 1 batch daripada menumpuk
 *   latensi pada whiteboard real-time.
 */
import {
  fail,
  ok,
  strokeEndPayloadSchema,
  strokePointsPayloadSchema,
  strokeStartPayloadSchema,
  type Ack,
  type StrokeEndPayload,
  type StrokePointsPayload,
  type StrokeStartPayload,
  type StrokeStartResult,
} from '@synccanvas/shared';
import type { Logger } from '../../lib/logger.js';
import type { RoomService } from '../../services/room.service.js';
import type { SyncSocket } from '../../types.js';
import { withErrorBoundary } from '../middleware/error-boundary.js';
import { consumeBudget } from '../middleware/rate-limit.js';
import { parsePayload, requireRoom } from '../validation.js';

export interface StrokeHandlerDeps {
  rooms: RoomService;
  logger: Logger;
}

export function registerStrokeHandlers(socket: SyncSocket, deps: StrokeHandlerDeps): void {
  const { rooms, logger } = deps;

  socket.on(
    'stroke:start',
    withErrorBoundary(
      logger,
      'stroke:start',
      (payload: StrokeStartPayload, ack: Ack<StrokeStartResult>) => {
        if (typeof ack !== 'function') return;
        if (!consumeBudget(socket, 'write')) {
          ack(fail('RATE_LIMITED', 'Terlalu banyak permintaan, coba lagi sebentar'));
          return;
        }

        const parsed = parsePayload(strokeStartPayloadSchema, payload);
        if (!parsed.ok) {
          ack(parsed);
          return;
        }

        const { roomId, strokeId, tool, color, width, point } = parsed.data;

        const membership = requireRoom(socket, roomId);
        if (!membership.ok) {
          ack(membership);
          return;
        }

        const started = rooms.startStroke(roomId, {
          id: strokeId,
          authorId: socket.id,
          tool,
          color,
          width,
          point,
        });
        if (!started.ok) {
          ack(started);
          return;
        }

        socket.to(roomId).emit('stroke:started', started.data.stroke);
        ack(ok({ strokeId, revision: started.data.revision }));
      },
    ),
  );

  socket.on(
    'stroke:points',
    withErrorBoundary(logger, 'stroke:points', (payload: StrokePointsPayload) => {
      // Tidak ada ack: event berfrekuensi tinggi, kegagalan di-drop saja.
      if (!consumeBudget(socket, 'cursor')) return;

      const parsed = parsePayload(strokePointsPayloadSchema, payload);
      if (!parsed.ok) return;

      const { roomId, strokeId, points } = parsed.data;
      const membership = requireRoom(socket, roomId);
      if (!membership.ok) return;

      const appended = rooms.appendPoints(roomId, strokeId, socket.id, points);
      if (!appended.ok) {
        // Stroke bisa sudah selesai karena race pointer-up; bukan kondisi fatal.
        logger.debug('Titik stroke ditolak', {
          roomId,
          strokeId,
          socketId: socket.id,
          code: appended.error.code,
        });
        return;
      }

      socket.to(roomId).volatile.emit('stroke:appended', {
        strokeId,
        points: appended.data.points,
        revision: appended.data.revision,
      });
    }),
  );

  socket.on(
    'stroke:end',
    withErrorBoundary(logger, 'stroke:end', (payload: StrokeEndPayload) => {
      if (!consumeBudget(socket, 'write')) return;

      const parsed = parsePayload(strokeEndPayloadSchema, payload);
      if (!parsed.ok) return;

      const { roomId, strokeId } = parsed.data;
      const membership = requireRoom(socket, roomId);
      if (!membership.ok) return;

      const ended = rooms.endStroke(roomId, strokeId, socket.id);
      if (!ended.ok) {
        socket.emit('server:error', ended.error);
        return;
      }
      if (ended.data.alreadyFinished) return;

      socket.to(roomId).emit('stroke:ended', {
        strokeId,
        revision: ended.data.revision,
      });
    }),
  );
}
