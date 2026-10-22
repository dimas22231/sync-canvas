/**
 * Wrapper untuk Socket.io acknowledgement dengan timeout.
 *
 * Socket.io tidak punya timeout ack bawaan pada API callback, sehingga tanpa
 * wrapper ini UI bisa menggantung selamanya bila server tidak membalas.
 * Semua hasil dikembalikan sebagai `Result` — tidak ada reject, sehingga
 * pemanggil tidak perlu try/catch untuk kegagalan yang sudah diantisipasi.
 */
import { fail, type Result } from '@synccanvas/shared';

export const ACK_TIMEOUT_MS = 5_000;

/**
 * @param send  Fungsi yang memanggil `socket.emit(event, payload, ack)`.
 * @param timeoutMs Batas waktu sebelum dianggap gagal.
 */
export function emitAck<T>(
  send: (ack: (response: Result<T>) => void) => void,
  timeoutMs: number = ACK_TIMEOUT_MS,
): Promise<Result<T>> {
  return new Promise((resolve) => {
    let isSettled = false;

    const settle = (result: Result<T>): void => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle(fail('ACK_TIMEOUT', 'Server tidak merespons tepat waktu'));
    }, timeoutMs);

    try {
      send((response) => settle(response));
    } catch (error) {
      settle(
        fail(
          'INTERNAL_ERROR',
          error instanceof Error ? error.message : 'Gagal mengirim event ke server',
        ),
      );
    }
  });
}
