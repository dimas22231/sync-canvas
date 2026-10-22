/**
 * Handler kursor real-time.
 *
 * Kursor tidak pernah disimpan: nilainya cepat basi dan tidak perlu ikut
 * snapshot board. Server hanya memvalidasi, membatasi frekuensi, lalu
 * meneruskan secara `volatile` ke peserta lain. Bila jaringan sedang padat,
 * posisi kursor lama boleh hilang — posisi berikutnya akan segera menyusul.
 */
import { cursorMovePayloadSchema, type CursorMovePayload } from '@synccanvas/shared';
import type { Logger } from '../../lib/logger.js';
import type { SyncSocket } from '../../types.js';
import { withErrorBoundary } from '../middleware/error-boundary.js';
import { consumeBudget } from '../middleware/rate-limit.js';
import { parsePayload, requireRoom } from '../validation.js';

export function registerCursorHandlers(socket: SyncSocket, logger: Logger): void {
  socket.on(
    'cursor:move',
    withErrorBoundary(logger, 'cursor:move', (payload: CursorMovePayload) => {
      // Frekuensi tinggi: drop diam-diam saat budget habis, tanpa ack/error.
      if (!consumeBudget(socket, 'cursor')) return;

      const parsed = parsePayload(cursorMovePayloadSchema, payload);
      if (!parsed.ok) return;

      const membership = requireRoom(socket, parsed.data.roomId);
      if (!membership.ok) return;

      socket.to(parsed.data.roomId).volatile.emit('cursor:update', {
        memberId: socket.id,
        x: parsed.data.x,
        y: parsed.data.y,
        updatedAt: Date.now(),
      });
    }),
  );
}
