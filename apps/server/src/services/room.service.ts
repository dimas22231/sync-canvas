/**
 * RoomService — inti domain whiteboard.
 *
 * Menyimpan state board di memori proses (MVP) dan menyembunyikan detail
 * penyimpanan dari layer transport (Socket.io handler). Dengan begitu:
 * - Handler hanya mengurus validasi, otorisasi, dan broadcast.
 * - Implementasi bisa diganti Redis/Postgres tanpa mengubah handler.
 *
 * Batasan MVP (lihat ARCHITECTURE.md):
 * - State hilang saat proses restart.
 * - Hanya benar untuk satu instance; multi-instance butuh Redis adapter +
 *   penyimpanan terpusat agar setiap node melihat board yang sama.
 */
import {
  fail,
  ok,
  type BoardClearResult,
  type Point,
  type Result,
  type RoomMember,
  type RoomState,
  type Stroke,
  type Tool,
} from '@synccanvas/shared';

/** Warna presence; dipilih deterministik berdasarkan urutan join. */
const MEMBER_COLORS = [
  '#7c9cff',
  '#4ade80',
  '#f472b6',
  '#facc15',
  '#38bdf8',
  '#fb923c',
  '#a78bfa',
  '#2dd4bf',
] as const;

/** Batas titik per stroke untuk mencegah satu client menghabiskan memori. */
const MAX_POINTS_PER_STROKE = 20_000;

export interface RoomServiceOptions {
  maxRooms: number;
  maxMembersPerRoom: number;
  maxStrokesPerRoom: number;
  /** Room kosong disimpan selama ini agar board tidak hilang saat semua keluar. */
  idleTtlMs: number;
}

export interface StartStrokeInput {
  id: string;
  authorId: string;
  tool: Tool;
  color: string;
  width: number;
  /** Titik pertama (pointer down) sekaligus membuat stroke. */
  point: Point;
}

interface Room {
  id: string;
  createdAt: number;
  /** Naik pada perubahan struktural: stroke baru, stroke selesai, clear board. */
  revision: number;
  lastActivityAt: number;
  members: Map<string, RoomMember>;
  strokes: Map<string, Stroke>;
}

export class RoomService {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly options: RoomServiceOptions) {}

  /**
   * Mendaftarkan socket ke room. Join berulang oleh socket yang sama bersifat
   * idempotent (mis. reconnect) dan mengembalikan member yang sudah ada.
   */
  join(roomId: string, socketId: string, displayName: string): Result<RoomMember> {
    const room = this.getOrCreateRoom(roomId);
    if (!room.ok) return room;
    const currentRoom = room.data;

    const existing = currentRoom.members.get(socketId);
    if (existing) return ok(existing);

    if (currentRoom.members.size >= this.options.maxMembersPerRoom) {
      return fail(
        'ROOM_FULL',
        `Room sudah penuh (maksimal ${this.options.maxMembersPerRoom} peserta)`,
      );
    }

    const member: RoomMember = {
      id: socketId,
      displayName,
      color: MEMBER_COLORS[currentRoom.members.size % MEMBER_COLORS.length] as string,
      joinedAt: Date.now(),
    };

    currentRoom.members.set(socketId, member);
    this.touch(currentRoom);

    return ok(member);
  }

  /** Mengeluarkan socket dari room. Idempotent: dipanggil saat leave & disconnect. */
  leave(roomId: string, socketId: string): Result<{ member: RoomMember }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'Room tidak ditemukan');

    const member = room.members.get(socketId);
    if (!member) return fail('NOT_IN_ROOM', 'Anda tidak berada di room ini');

    room.members.delete(socketId);
    // lastActivityAt sengaja diperbarui agar ruang kosong diberi tenggang TTL
    // sebelum dibersihkan — peserta bisa reconnect tanpa kehilangan board.
    this.touch(room);

    return ok({ member });
  }

  /**
   * Snapshot lengkap untuk sinkronisasi awal. Dipanggil setelah join agar
   * client langsung memiliki seluruh stroke (termasuk stroke yang belum selesai).
   */
  getState(roomId: string): Result<RoomState> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'Room tidak ditemukan');

    return ok({
      roomId: room.id,
      revision: room.revision,
      createdAt: room.createdAt,
      members: [...room.members.values()],
      strokes: [...room.strokes.values()],
    });
  }

  /** Membuat stroke baru. `input.id` berasal dari client (UUID) untuk optimistic UI. */
  startStroke(
    roomId: string,
    input: StartStrokeInput,
  ): Result<{ stroke: Stroke; revision: number }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'Room tidak ditemukan');

    if (room.strokes.size >= this.options.maxStrokesPerRoom) {
      return fail('BOARD_FULL', 'Board sudah mencapai batas jumlah stroke');
    }
    if (room.strokes.has(input.id)) {
      return fail('STROKE_ALREADY_EXISTS', 'Stroke dengan id tersebut sudah ada');
    }

    const now = Date.now();
    const stroke: Stroke = {
      id: input.id,
      roomId,
      authorId: input.authorId,
      tool: input.tool,
      color: input.color,
      width: input.width,
      points: [input.point],
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };

    room.strokes.set(stroke.id, stroke);
    room.revision += 1;
    this.touch(room);

    return ok({ stroke, revision: room.revision });
  }

  /** Menambahkan batch titik ke stroke yang masih aktif. */
  appendPoints(
    roomId: string,
    strokeId: string,
    authorId: string,
    points: Point[],
  ): Result<{ points: Point[]; revision: number }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'Room tidak ditemukan');

    const stroke = room.strokes.get(strokeId);
    if (!stroke) return fail('STROKE_NOT_FOUND', 'Stroke tidak ditemukan');
    if (stroke.authorId !== authorId) {
      return fail('FORBIDDEN', 'Hanya pembuat stroke yang boleh menambah titik');
    }
    if (stroke.finishedAt !== null) {
      return fail('STROKE_FINISHED', 'Stroke sudah selesai');
    }
    if (stroke.points.length + points.length > MAX_POINTS_PER_STROKE) {
      return fail('BOARD_FULL', 'Stroke terlalu panjang');
    }

    stroke.points.push(...points);
    stroke.updatedAt = Date.now();
    this.touch(room);

    return ok({ points, revision: room.revision });
  }

  /**
   * Menutup stroke. Idempotent agar retry/disconnect tepat setelah pointer up
   * tidak menghasilkan error yang membingungkan.
   */
  endStroke(
    roomId: string,
    strokeId: string,
    authorId: string,
  ): Result<{ revision: number; alreadyFinished: boolean }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'Room tidak ditemukan');

    const stroke = room.strokes.get(strokeId);
    if (!stroke) return fail('STROKE_NOT_FOUND', 'Stroke tidak ditemukan');
    if (stroke.authorId !== authorId) {
      return fail('FORBIDDEN', 'Hanya pembuat stroke yang boleh mengakhirinya');
    }

    if (stroke.finishedAt !== null) {
      return ok({ revision: room.revision, alreadyFinished: true });
    }

    stroke.finishedAt = Date.now();
    stroke.updatedAt = stroke.finishedAt;
    room.revision += 1;
    this.touch(room);

    return ok({ revision: room.revision, alreadyFinished: false });
  }

  /** Menghapus seluruh stroke. Otorisasi (anggota room) dilakukan handler. */
  clearBoard(roomId: string): Result<BoardClearResult> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'Room tidak ditemukan');

    room.strokes.clear();
    room.revision += 1;
    this.touch(room);

    return ok({ revision: room.revision, clearedAt: Date.now() });
  }

  /**
   * Menghapus room yang kosong dan sudah melewati TTL.
   * Dipanggil berkala dari bootstrap; mengembalikan jumlah room yang dihapus.
   */
  sweepIdleRooms(now = Date.now()): number {
    let removed = 0;

    for (const [roomId, room] of this.rooms) {
      const isEmpty = room.members.size === 0;
      const isExpired = now - room.lastActivityAt > this.options.idleTtlMs;
      if (isEmpty && isExpired) {
        this.rooms.delete(roomId);
        removed += 1;
      }
    }

    return removed;
  }

  /** Metrik ringan untuk endpoint /health tanpa membocorkan isi board. */
  getStats(): { rooms: number; members: number; strokes: number } {
    let members = 0;
    let strokes = 0;

    for (const room of this.rooms.values()) {
      members += room.members.size;
      strokes += room.strokes.size;
    }

    return { rooms: this.rooms.size, members, strokes };
  }

  private getOrCreateRoom(roomId: string): Result<Room> {
    const existing = this.rooms.get(roomId);
    if (existing) return ok(existing);

    if (this.rooms.size >= this.options.maxRooms) {
      return fail('ROOM_FULL', 'Kapasitas room di server sudah penuh');
    }

    const now = Date.now();
    const room: Room = {
      id: roomId,
      createdAt: now,
      revision: 0,
      lastActivityAt: now,
      members: new Map(),
      strokes: new Map(),
    };
    this.rooms.set(roomId, room);

    return ok(room);
  }

  private touch(room: Room): void {
    room.lastActivityAt = Date.now();
  }
}
