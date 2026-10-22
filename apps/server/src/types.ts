/**
 * Alias tipe Socket.io yang sudah terikat pada kontrak di `@synccanvas/shared`.
 * Menghindari penulisan generic berulang dan memastikan client/server memakai
 * event map yang sama.
 */
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@synccanvas/shared';

export type SyncServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type SyncSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
