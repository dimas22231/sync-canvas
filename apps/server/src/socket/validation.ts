/**
 * Utilitas validasi payload socket.
 *
 * Semua input dari network diperlakukan sebagai `unknown` sampai lolos Zod.
 * Hasilnya memakai envelope `Result` agar handler dapat merespons lewat ack
 * tanpa melempar exception.
 */
import type { ZodType } from 'zod';
import { fail, ok, type Result } from '@synccanvas/shared';
import type { SyncSocket } from '../types.js';

/** Validasi payload dan ubah error Zod menjadi kode `VALIDATION_ERROR`. */
export function parsePayload<T>(schema: ZodType<T>, payload: unknown): Result<T> {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return ok(parsed.data);

  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

  return fail('VALIDATION_ERROR', 'Payload tidak valid', issues);
}

/**
 * Memastikan socket benar-benar anggota room yang disebut di payload.
 * `socket.data.roomId` di-set server saat join, sehingga client tidak bisa
 * mengaku-ngaku berada di room lain hanya dengan mengubah payload.
 */
export function requireRoom(socket: SyncSocket, roomId: string): Result<null> {
  if (socket.data.roomId !== roomId) {
    return fail('NOT_IN_ROOM', 'Anda tidak berada di room ini');
  }
  return ok(null);
}
