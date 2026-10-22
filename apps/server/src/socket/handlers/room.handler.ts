/**
 * Handler lifecycle room & presence.
 *
 * Tanggung jawab:
 * - join/leave room (single-room per socket).
 * - Mengirim snapshot board (`room:state`) kepada peserta yang baru join.
 * - Menyiarkan presence (member joined/left) ke peserta lain.
 * - Membersihkan membership saat disconnect.
 */
import {
  boardClearPayloadSchema,
  fail,
  joinPayloadSchema,
  ok,
  type Ack,
  type BoardClearPayload,
  type BoardClearResult,
  type JoinPayload,
  type JoinResult,
} from '@synccanvas/shared';
import type { Logger } from '../../lib/logger.js';
import type { RoomService } from '../../services/room.service.js';
import type { SyncServer, SyncSocket } from '../../types.js';
import { withErrorBoundary } from '../middleware/error-boundary.js';
import { consumeBudget } from '../middleware/rate-limit.js';
import { parsePayload, requireRoom } from '../validation.js';

export interface RoomHandlerDeps {
  rooms: RoomService;
  logger: Logger;
}

/**
 * Keluar dari room aktif (jika ada) dan beri tahu peserta lain.
 * Dipakai oleh `room:leave`, perpindahan room, dan `disconnect`.
 */
function leaveCurrentRoom(
  io: SyncServer,
  socket: SyncSocket,
  deps: RoomHandlerDeps,
  reason: string,
): void {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  socket.data.roomId = null;
  const left = deps.rooms.leave(roomId, socket.id);
  socket.leave(roomId);

  if (!left.ok) {
    deps.logger.warn('Gagal keluar dari room', {
      roomId,
      socketId: socket.id,
      reason,
      error: left.error.message,
    });
    return;
  }

  io.to(roomId).emit('room:member-left', { memberId: socket.id });
  deps.logger.info('Member keluar', {
    roomId,
    socketId: socket.id,
    displayName: left.data.member.displayName,
    reason,
  });
}

export function registerRoomHandlers(
  io: SyncServer,
  socket: SyncSocket,
  deps: RoomHandlerDeps,
): void {
  const { rooms, logger } = deps;

  socket.on(
    'room:join',
    withErrorBoundary(logger, 'room:join', async (payload: JoinPayload, ack: Ack<JoinResult>) => {
      if (typeof ack !== 'function') return;
      if (!consumeBudget(socket, 'write')) {
        ack(fail('RATE_LIMITED', 'Terlalu banyak permintaan, coba lagi sebentar'));
        return;
      }

      const parsed = parsePayload(joinPayloadSchema, payload);
      if (!parsed.ok) {
        ack(parsed);
        return;
      }

      const { roomId, displayName } = parsed.data;

      // Satu socket hanya boleh berada di satu room pada satu waktu.
      if (socket.data.roomId && socket.data.roomId !== roomId) {
        leaveCurrentRoom(io, socket, deps, 'switch room');
      }

      const joined = rooms.join(roomId, socket.id, displayName);
      if (!joined.ok) {
        ack(joined);
        return;
      }

      await socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.displayName = joined.data.displayName;
      socket.data.color = joined.data.color;

      const state = rooms.getState(roomId);
      if (!state.ok) {
        // Praktis tidak terjadi karena room baru saja dibuat; tetap tangani
        // agar ack tidak menggantung.
        leaveCurrentRoom(io, socket, deps, 'state unavailable');
        ack(state);
        return;
      }

      // Snapshot dikirim sebagai event (bukan bagian ack) agar jalur
      // sinkronisasi state tetap satu: `room:state`.
      socket.emit('room:state', state.data);
      socket.to(roomId).emit('room:member-joined', joined.data);
      ack(ok({ selfId: socket.id }));

      logger.info('Member join', {
        roomId,
        socketId: socket.id,
        displayName,
        members: state.data.members.length,
      });
    }),
  );

  socket.on(
    'room:leave',
    withErrorBoundary(logger, 'room:leave', () => {
      leaveCurrentRoom(io, socket, deps, 'client request');
    }),
  );

  socket.on(
    'board:clear',
    withErrorBoundary(
      logger,
      'board:clear',
      (payload: BoardClearPayload, ack: Ack<BoardClearResult>) => {
        if (typeof ack !== 'function') return;
        if (!consumeBudget(socket, 'write')) {
          ack(fail('RATE_LIMITED', 'Terlalu banyak permintaan, coba lagi sebentar'));
          return;
        }

        const parsed = parsePayload(boardClearPayloadSchema, payload);
        if (!parsed.ok) {
          ack(parsed);
          return;
        }

        const membership = requireRoom(socket, parsed.data.roomId);
        if (!membership.ok) {
          ack(membership);
          return;
        }

        const cleared = rooms.clearBoard(parsed.data.roomId);
        if (!cleared.ok) {
          ack(cleared);
          return;
        }

        // Clear disiarkan ke semua peserta (termasuk pengirim) karena semua
        // client harus mengosongkan board secara konsisten.
        io.to(parsed.data.roomId).emit('board:cleared', {
          by: socket.id,
          at: cleared.data.clearedAt,
          revision: cleared.data.revision,
        });
        ack(ok(cleared.data));

        logger.info('Board dibersihkan', {
          roomId: parsed.data.roomId,
          socketId: socket.id,
          revision: cleared.data.revision,
        });
      },
    ),
  );

  socket.on('disconnect', (reason) => {
    leaveCurrentRoom(io, socket, deps, `disconnect: ${reason}`);
  });
}
