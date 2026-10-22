/**
 * SyncCanvas — satu-satunya sumber kebenaran untuk kontrak client <-> server.
 *
 * Modul ini sengaja bebas dari dependensi Node.js / browser sehingga dapat
 * diimpor oleh Next.js (browser) maupun Socket.io server. Semua payload
 * divalidasi di runtime dengan Zod *dan* diturunkan menjadi tipe TypeScript,
 * sehingga skema dan tipe tidak pernah berbeda.
 *
 * Aturan penting:
 * - Event menggunakan format `domain:action` (lowercase), mis. `stroke:start`.
 * - Payload yang dikirim client tidak pernah dipercaya; server memvalidasi ulang.
 * - Semua ack memakai envelope {@link Result} agar error tidak dilempar
 *   sebagai exception dan bisa ditangani secara eksplisit di UI.
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/*                                   Domain                                   */
/* -------------------------------------------------------------------------- */

/** Tool yang didukung renderer whiteboard. */
export const TOOL_TYPES = ['pen', 'highlighter', 'eraser'] as const;
export type Tool = (typeof TOOL_TYPES)[number];

/**
 * Format `roomId`: 3-64 karakter, huruf kecil/angka/tanda hubung.
 * Sengaja dibatasi agar aman dipakai sebagai URL path dan key cache.
 */
export const ROOM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/;

/** Batas jumlah titik per paket `stroke:points` (anti payload raksasa). */
export const MAX_POINTS_PER_BATCH = 256;

/** Titik koordinat pada bidang whiteboard (unit virtual, bukan pixel). */
export interface Point {
  x: number;
  y: number;
  /** Tekanan stylus 0..1 (opsional, hanya jika perangkat mendukung). */
  pressure?: number;
}

/** Satu goresan utuh, dari pointer down sampai pointer up. */
export interface Stroke {
  id: string;
  roomId: string;
  /** Socket id milik pembuat stroke (identitas anonim untuk MVP). */
  authorId: string;
  tool: Tool;
  /** Warna HEX, mis. `#7c9cff`. */
  color: string;
  /** Ketebalan dalam unit virtual (1-64). */
  width: number;
  points: Point[];
  createdAt: number;
  updatedAt: number;
  /** `null` selama stroke masih digambar. */
  finishedAt: number | null;
}

/** Peserta yang sedang terhubung ke sebuah room. */
export interface RoomMember {
  id: string;
  displayName: string;
  /** Warna presence yang diberikan server (stabil selama sesi). */
  color: string;
  joinedAt: number;
}

/**
 * Snapshot board yang dikirim server saat client join / resync.
 * `revision` naik setiap perubahan struktural (stroke baru, stroke selesai,
 * clear board) dan berguna untuk observability serta debugging urutan event.
 */
export interface RoomState {
  roomId: string;
  revision: number;
  createdAt: number;
  members: RoomMember[];
  strokes: Stroke[];
}

/** Posisi kursor real-time milik peserta lain. */
export interface CursorPosition {
  memberId: string;
  x: number;
  y: number;
  /** Timestamp server; client membuang kursor yang sudah basi. */
  updatedAt: number;
}

/* -------------------------------------------------------------------------- */
/*                              Result & error                                */
/* -------------------------------------------------------------------------- */

/**
 * Kode error yang stabil dan bisa diterjemahkan di UI.
 * Client tidak boleh menampilkan `message` mentah untuk kode internal.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_IN_ROOM'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'BOARD_FULL'
  | 'STROKE_NOT_FOUND'
  | 'STROKE_ALREADY_EXISTS'
  | 'STROKE_FINISHED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INVALID_STATE'
  | 'NOT_CONNECTED'
  | 'ACK_TIMEOUT'
  | 'CONNECTION_ERROR'
  | 'INTERNAL_ERROR';

export interface AppError {
  code: ErrorCode;
  message: string;
  /** Detail tambahan, mis. daftar issue validasi. Jangan berisi data sensitif. */
  details?: unknown;
}

/** Envelope hasil operasi: tidak ada `throw` untuk error yang terduga. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Callback acknowledgement Socket.io. */
export type Ack<T> = (response: Result<T>) => void;

/** Helper untuk membuat hasil sukses tanpa cast berulang di call site. */
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

/** Helper untuk membuat hasil gagal. */
export const fail = (code: ErrorCode, message: string, details?: unknown): Result<never> => ({
  ok: false,
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

/* -------------------------------------------------------------------------- */
/*                            Zod schemas & payloads                          */
/* -------------------------------------------------------------------------- */

const roomIdSchema = z
  .string()
  .trim()
  .regex(ROOM_ID_PATTERN, 'roomId harus 3-64 karakter: huruf kecil, angka, atau tanda hubung');

/** Batas koordinat menjaga angka tetap finite dan mencegah overflow renderer. */
const coordinateSchema = z.number().min(-100_000).max(100_000);

const pointSchema = z.object({
  x: coordinateSchema,
  y: coordinateSchema,
  pressure: z.number().min(0).max(1).optional(),
});

export const joinPayloadSchema = z.object({
  roomId: roomIdSchema,
  displayName: z
    .string()
    .trim()
    .min(1, 'Nama tidak boleh kosong')
    .max(32, 'Nama maksimal 32 karakter'),
});

export const strokeStartPayloadSchema = z.object({
  roomId: roomIdSchema,
  /** UUID v4 dibuat client agar optimistic update dan broadcast memakai id sama. */
  strokeId: z.string().uuid(),
  tool: z.enum(TOOL_TYPES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus format HEX, mis. #7c9cff'),
  width: z.number().min(1).max(64),
  point: pointSchema,
});

export const strokePointsPayloadSchema = z.object({
  roomId: roomIdSchema,
  strokeId: z.string().uuid(),
  points: z.array(pointSchema).min(1).max(MAX_POINTS_PER_BATCH),
});

export const strokeEndPayloadSchema = z.object({
  roomId: roomIdSchema,
  strokeId: z.string().uuid(),
});

export const cursorMovePayloadSchema = z.object({
  roomId: roomIdSchema,
  x: coordinateSchema,
  y: coordinateSchema,
});

export const boardClearPayloadSchema = z.object({
  roomId: roomIdSchema,
});

export type JoinPayload = z.infer<typeof joinPayloadSchema>;
export type StrokeStartPayload = z.infer<typeof strokeStartPayloadSchema>;
export type StrokePointsPayload = z.infer<typeof strokePointsPayloadSchema>;
export type StrokeEndPayload = z.infer<typeof strokeEndPayloadSchema>;
export type CursorMovePayload = z.infer<typeof cursorMovePayloadSchema>;
export type BoardClearPayload = z.infer<typeof boardClearPayloadSchema>;

/* -------------------------------------------------------------------------- */
/*                                Ack results                                 */
/* -------------------------------------------------------------------------- */

export interface JoinResult {
  /** Socket id milik client setelah join; dipakai untuk menandai stroke sendiri. */
  selfId: string;
}

export interface StrokeStartResult {
  strokeId: string;
  revision: number;
}

export interface BoardClearResult {
  revision: number;
  clearedAt: number;
}

/* -------------------------------------------------------------------------- */
/*                              Socket.io contracts                           */
/* -------------------------------------------------------------------------- */

/**
 * Event dari client ke server.
 * `stroke:points` dan `cursor:move` sengaja tanpa ack karena berfrekuensi
 * tinggi — kegagalan individual tidak layak memblokir UI.
 */
export interface ClientToServerEvents {
  'room:join': (payload: JoinPayload, ack: Ack<JoinResult>) => void;
  'room:leave': () => void;
  'cursor:move': (payload: CursorMovePayload) => void;
  'stroke:start': (payload: StrokeStartPayload, ack: Ack<StrokeStartResult>) => void;
  'stroke:points': (payload: StrokePointsPayload) => void;
  'stroke:end': (payload: StrokeEndPayload) => void;
  'board:clear': (payload: BoardClearPayload, ack: Ack<BoardClearResult>) => void;
}

/**
 * Event dari server ke client.
 * `stroke:started/appended/ended` tidak di-echo ke pengirim karena pengirim
 * sudah melakukan optimistic update; server hanya menyiarkan ke peserta lain.
 */
export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:member-joined': (member: RoomMember) => void;
  'room:member-left': (payload: { memberId: string }) => void;
  'cursor:update': (cursor: CursorPosition) => void;
  'stroke:started': (stroke: Stroke) => void;
  'stroke:appended': (payload: { strokeId: string; points: Point[]; revision: number }) => void;
  'stroke:ended': (payload: { strokeId: string; revision: number }) => void;
  'board:cleared': (payload: { by: string; at: number; revision: number }) => void;
  'server:error': (error: AppError) => void;
}

/** Tidak ada komunikasi antar node saat ini (single instance). */
export interface InterServerEvents {}

/**
 * Data yang ditempelkan Socket.io ke setiap socket di sisi server.
 * `roomId` disimpan di sini agar server tidak mempercayai `roomId` dari payload
 * untuk menentukan otorisasi.
 */
export interface SocketData {
  userId: string;
  roomId: string | null;
  displayName?: string;
  color?: string;
}
