/**
 * Singleton Socket.io client.
 *
 * Satu koneksi dipakai bersama seluruh halaman agar:
 * - Reconnect tidak membuat koneksi baru setiap render.
 * - Presence/room state tidak terputus saat navigasi antar komponen.
 *
 * Catatan: modul ini hanya boleh diimpor dari client component. `io()` tidak
 * dipanggil saat modul dievaluasi, sehingga aman dari evaluasi SSR.
 *
 * Kepemilikan koneksi dipegang oleh `useWhiteboardSocket`. Gunakan satu
 * consumer hook per halaman: cleanup hook akan memutus socket bersama.
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@synccanvas/shared';

/** Socket dengan event map yang sama persis dengan server. */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const DEFAULT_WS_URL = 'http://localhost:4000';

let sharedSocket: AppSocket | null = null;

/**
 * Mengembalikan socket singleton (membuatnya sekali bila belum ada).
 * @throws Jika dipanggil di luar browser.
 */
export function getSocket(
  url: string = process.env.NEXT_PUBLIC_WS_URL ?? DEFAULT_WS_URL,
): AppSocket {
  if (typeof window === 'undefined') {
    throw new Error('getSocket() hanya boleh dipanggil di browser.');
  }

  if (!sharedSocket) {
    sharedSocket = io(url, {
      // Koneksi dibuka eksplisit oleh hook agar lifecycle-nya jelas dan
      // StrictMode double-mount tidak meninggalkan koneksi yatim.
      autoConnect: false,
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      timeout: 10_000,
      // Produksi: kirim JWT lewat `auth: { token }` lalu verifikasi di io.use().
    });
  }

  return sharedSocket;
}
