'use client';

/**
 * useWhiteboardSocket — otak sinkronisasi whiteboard di sisi client.
 *
 * Tanggung jawab hook ini:
 * 1. Lifecycle koneksi (connect, join room, reconnect, cleanup).
 * 2. Menerjemahkan event server menjadi state React yang siap dirender.
 * 3. Optimistic update: coretan lokal langsung tampil tanpa menunggu server.
 * 4. Batching & throttling: kursor dibatasi 20 event/detik, titik stroke
 *    dikirim per 50 ms, dan commit ke React dilakukan sekali per frame.
 *
 * Prinsip penting:
 * - High-frequency data (titik & kursor) disimpan di `ref` lalu di-commit ke
 *   state lewat `requestAnimationFrame`. Ini menghindari render per titik.
 * - Server tetap sumber kebenaran; `room:state` menimpa state lokal saat join
 *   sehingga client yang tertinggal (atau reconnect) kembali konsisten.
 * - Semua kegagalan operasi penting dikembalikan sebagai `Result`, bukan
 *   exception, agar UI dapat menampilkan pesan yang sesuai.
 *
 * Contoh pemakaian:
 * ```tsx
 * const { status, strokes, actions } = useWhiteboardSocket({
 *   roomId: 'design-sprint',
 *   displayName: 'Rani',
 * });
 *
 * actions.startStroke({ tool: 'pen', color: '#7c9cff', width: 3, point });
 * actions.extendStroke([nextPoint]);
 * await actions.endStroke();
 * ```
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fail,
  ok,
  type AppError,
  type BoardClearResult,
  type CursorPosition,
  type JoinResult,
  type Point,
  type Result,
  type RoomMember,
  type RoomState,
  type Stroke,
  type StrokeStartResult,
  type Tool,
} from '@synccanvas/shared';
import { emitAck } from '@/lib/ack';
import { getSocket, type AppSocket } from '@/lib/socket';
import { createThrottle } from '@/lib/throttle';

/** Kursor dikirim maksimal 20x/detik; mata manusia tidak melihat bedanya. */
const CURSOR_THROTTLE_MS = 50;
/** Titik stroke di-batch dan dikirim tiap 50 ms (20 batch/detik). */
const POINT_FLUSH_INTERVAL_MS = 50;
/** Kursor peserta yang tidak bergerak > 8 detik dihapus dari layar. */
const CURSOR_STALE_MS = 8_000;
const CURSOR_SWEEP_INTERVAL_MS = 3_000;

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface StartStrokeInput {
  tool: Tool;
  /** HEX, mis. `#7c9cff`. */
  color: string;
  /** Ketebalan 1-64 unit virtual. */
  width: number;
  /** Titik pertama dari event pointer down. */
  point: Point;
}

export interface WhiteboardActions {
  /** Membuat stroke baru (optimistic) dan mendaftarkannya ke server. */
  startStroke(input: StartStrokeInput): Promise<Result<null>>;
  /** Menambah titik ke stroke aktif; aman dipanggil sangat sering. */
  extendStroke(points: Point[]): void;
  /** Menutup stroke aktif dan mengirim sisa titik yang masih di buffer. */
  endStroke(): Promise<Result<null>>;
  /** Mengirim posisi kursor (sudah di-throttle di dalam). */
  sendCursor(x: number, y: number): void;
  /** Menghapus seluruh board untuk semua peserta. */
  clearBoard(): Promise<Result<null>>;
}

export interface UseWhiteboardSocketOptions {
  /** Harus cocok dengan `ROOM_ID_PATTERN` di shared package. */
  roomId: string;
  displayName: string;
  /** `false` menunda koneksi (mis. sebelum user menekan "Join"). */
  enabled?: boolean;
  /** Override URL server; default `NEXT_PUBLIC_WS_URL`. */
  url?: string;
}

export interface UseWhiteboardSocketResult {
  status: ConnectionStatus;
  selfId: string | null;
  members: RoomMember[];
  strokes: Stroke[];
  cursors: CursorPosition[];
  revision: number;
  error: AppError | null;
  actions: WhiteboardActions;
  clearError(): void;
}

export function useWhiteboardSocket({
  roomId,
  displayName,
  enabled = true,
  url,
}: UseWhiteboardSocketOptions): UseWhiteboardSocketResult {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [selfId, setSelfId] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<AppError | null>(null);

  const socketRef = useRef<AppSocket | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const strokesRef = useRef<Map<string, Stroke>>(new Map());
  const cursorsRef = useRef<Map<string, CursorPosition>>(new Map());
  const pendingPointsRef = useRef<Point[]>([]);
  const activeStrokeRef = useRef<{ id: string; roomId: string } | null>(null);
  const frameRef = useRef<number | null>(null);
  /** Diisi oleh effect agar `endStroke` bisa mem-flush buffer sebelum menutup. */
  const flushPendingPointsRef = useRef<() => void>(() => {});

  /**
   * Commit state high-frequency sekali per frame.
   * Dipanggil dari event handler; tidak pernah memicu render berlebih.
   */
  const scheduleCommit = useCallback(() => {
    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setStrokes([...strokesRef.current.values()]);
      setCursors([...cursorsRef.current.values()]);
    });
  }, []);

  useEffect(() => {
    if (!enabled || !roomId || !displayName) return;

    const socket = getSocket(url);
    socketRef.current = socket;

    let disposed = false;
    /** Membedakan disconnect manual karena join gagal dari disconnect biasa. */
    let joinFailed = false;

    strokesRef.current.clear();
    cursorsRef.current.clear();
    pendingPointsRef.current = [];
    activeStrokeRef.current = null;
    selfIdRef.current = null;

    setStatus('connecting');
    setSelfId(null);
    setMembers([]);
    setStrokes([]);
    setCursors([]);
    setRevision(0);
    setError(null);

    /* ----------------------------- Inbound ----------------------------- */

    const handleState = (state: RoomState): void => {
      // Snapshot server selalu menang (termasuk saat reconnect setelah offline).
      strokesRef.current = new Map(state.strokes.map((stroke) => [stroke.id, stroke]));
      pendingPointsRef.current = [];
      activeStrokeRef.current = null;
      setMembers(state.members);
      setRevision(state.revision);
      scheduleCommit();
    };

    const handleMemberJoined = (member: RoomMember): void => {
      setMembers((previous) => {
        const index = previous.findIndex((item) => item.id === member.id);
        if (index === -1) return [...previous, member];
        const next = [...previous];
        next[index] = member;
        return next;
      });
    };

    const handleMemberLeft = ({ memberId }: { memberId: string }): void => {
      setMembers((previous) => previous.filter((member) => member.id !== memberId));
      cursorsRef.current.delete(memberId);
      scheduleCommit();
    };

    const handleStrokeStarted = (stroke: Stroke): void => {
      strokesRef.current.set(stroke.id, stroke);
      scheduleCommit();
    };

    const handleStrokeAppended = ({
      strokeId,
      points,
    }: {
      strokeId: string;
      points: Point[];
    }): void => {
      const stroke = strokesRef.current.get(strokeId);
      // Bisa terjadi bila snapshot belum tiba; room:state akan menyusulkan.
      if (!stroke) return;

      strokesRef.current.set(strokeId, {
        ...stroke,
        points: [...stroke.points, ...points],
        updatedAt: Date.now(),
      });
      scheduleCommit();
    };

    const handleStrokeEnded = ({ strokeId }: { strokeId: string }): void => {
      const stroke = strokesRef.current.get(strokeId);
      if (!stroke) return;

      const finishedAt = Date.now();
      strokesRef.current.set(strokeId, { ...stroke, finishedAt, updatedAt: finishedAt });
      scheduleCommit();
    };

    const handleBoardCleared = (): void => {
      strokesRef.current.clear();
      pendingPointsRef.current = [];
      activeStrokeRef.current = null;
      setStrokes([]);
      scheduleCommit();
    };

    const handleCursorUpdate = (cursor: CursorPosition): void => {
      if (cursor.memberId === selfIdRef.current) return;
      cursorsRef.current.set(cursor.memberId, cursor);
      scheduleCommit();
    };

    const handleServerError = (serverError: AppError): void => {
      setError(serverError);
    };

    /* ---------------------------- Connection --------------------------- */

    const joinRoom = async (): Promise<void> => {
      const response = await emitAck<JoinResult>((ack) =>
        socket.emit('room:join', { roomId, displayName }, ack),
      );
      if (disposed) return;

      if (!response.ok) {
        joinFailed = true;
        setError(response.error);
        setStatus('error');
        socket.disconnect();
        return;
      }

      selfIdRef.current = response.data.selfId;
      setSelfId(response.data.selfId);
      setError(null);
      setStatus('connected');
    };

    const handleConnect = (): void => {
      // Join ulang setiap reconnect: server memberi socket id baru.
      void joinRoom();
    };

    const handleDisconnect = (reason: string): void => {
      selfIdRef.current = null;
      setSelfId(null);
      setMembers([]);
      cursorsRef.current.clear();
      scheduleCommit();

      if (joinFailed || disposed) return;
      setStatus(reason === 'io client disconnect' ? 'idle' : 'reconnecting');
    };

    const handleConnectError = (connectError: Error): void => {
      setError({ code: 'CONNECTION_ERROR', message: connectError.message });
      setStatus('error');
    };

    /* ----------------------------- Outbound ---------------------------- */

    /**
     * Mengosongkan buffer titik ke server. Dipanggil oleh interval 50 ms dan
     * sebelum `stroke:end` agar tidak ada titik yang tertinggal.
     *
     * Urutan TCP menjamin `stroke:points` tiba sebelum `stroke:end`, sehingga
     * server tidak perlu ack untuk operasi berfrekuensi tinggi ini.
     */
    const flushPendingPoints = (): void => {
      const active = activeStrokeRef.current;
      if (!active || pendingPointsRef.current.length === 0) return;
      if (!socket.connected) return;

      const points = pendingPointsRef.current;
      pendingPointsRef.current = [];
      socket.emit('stroke:points', { roomId: active.roomId, strokeId: active.id, points });
    };
    flushPendingPointsRef.current = flushPendingPoints;

    const sweepStaleCursors = (): void => {
      const now = Date.now();
      let changed = false;

      for (const [memberId, cursor] of cursorsRef.current) {
        if (now - cursor.updatedAt > CURSOR_STALE_MS) {
          cursorsRef.current.delete(memberId);
          changed = true;
        }
      }

      if (changed) scheduleCommit();
    };

    /* ----------------------------- Wiring ------------------------------ */

    socket.on('room:state', handleState);
    socket.on('room:member-joined', handleMemberJoined);
    socket.on('room:member-left', handleMemberLeft);
    socket.on('stroke:started', handleStrokeStarted);
    socket.on('stroke:appended', handleStrokeAppended);
    socket.on('stroke:ended', handleStrokeEnded);
    socket.on('board:cleared', handleBoardCleared);
    socket.on('cursor:update', handleCursorUpdate);
    socket.on('server:error', handleServerError);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    const pointFlushTimer = window.setInterval(flushPendingPoints, POINT_FLUSH_INTERVAL_MS);
    const cursorSweepTimer = window.setInterval(sweepStaleCursors, CURSOR_SWEEP_INTERVAL_MS);

    if (socket.connected) void joinRoom();
    else socket.connect();

    return () => {
      disposed = true;
      window.clearInterval(pointFlushTimer);
      window.clearInterval(cursorSweepTimer);

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      socket.off('room:state', handleState);
      socket.off('room:member-joined', handleMemberJoined);
      socket.off('room:member-left', handleMemberLeft);
      socket.off('stroke:started', handleStrokeStarted);
      socket.off('stroke:appended', handleStrokeAppended);
      socket.off('stroke:ended', handleStrokeEnded);
      socket.off('board:cleared', handleBoardCleared);
      socket.off('cursor:update', handleCursorUpdate);
      socket.off('server:error', handleServerError);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);

      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;

      flushPendingPointsRef.current = () => {};
      activeStrokeRef.current = null;
      pendingPointsRef.current = [];
      selfIdRef.current = null;
    };
  }, [enabled, roomId, displayName, url, scheduleCommit]);

  /* ------------------------------ Actions ------------------------------ */

  const startStroke = useCallback(
    async (input: StartStrokeInput): Promise<Result<null>> => {
      const socket = socketRef.current;
      if (!socket?.connected || !selfIdRef.current) {
        return fail('NOT_CONNECTED', 'Belum terhubung ke server');
      }
      if (activeStrokeRef.current) {
        return fail('INVALID_STATE', 'Masih ada stroke aktif yang belum ditutup');
      }
      if (pendingPointsRef.current.length > 0) {
        flushPendingPointsRef.current();
      }

      const strokeId = crypto.randomUUID();
      const now = Date.now();

      // Optimistic: coretan langsung terlihat sebelum server membalas.
      strokesRef.current.set(strokeId, {
        id: strokeId,
        roomId,
        authorId: selfIdRef.current,
        tool: input.tool,
        color: input.color,
        width: input.width,
        points: [input.point],
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
      });
      activeStrokeRef.current = { id: strokeId, roomId };
      scheduleCommit();

      const response = await emitAck<StrokeStartResult>((ack) =>
        socket.emit(
          'stroke:start',
          {
            roomId,
            strokeId,
            tool: input.tool,
            color: input.color,
            width: input.width,
            point: input.point,
          },
          ack,
        ),
      );

      if (!response.ok) {
        // Rollback optimistic update agar tidak ada "coretan hantu".
        strokesRef.current.delete(strokeId);
        if (activeStrokeRef.current?.id === strokeId) activeStrokeRef.current = null;
        pendingPointsRef.current = [];
        scheduleCommit();
        setError(response.error);
        return fail(response.error.code, response.error.message, response.error.details);
      }

      return ok(null);
    },
    [roomId, scheduleCommit],
  );

  const extendStroke = useCallback(
    (points: Point[]): void => {
      const active = activeStrokeRef.current;
      if (!active || points.length === 0 || !socketRef.current?.connected) return;

      const stroke = strokesRef.current.get(active.id);
      if (!stroke) return;

      strokesRef.current.set(active.id, {
        ...stroke,
        points: [...stroke.points, ...points],
        updatedAt: Date.now(),
      });
      pendingPointsRef.current.push(...points);
      scheduleCommit();
    },
    [scheduleCommit],
  );

  const endStroke = useCallback(async (): Promise<Result<null>> => {
    const active = activeStrokeRef.current;
    if (!active) return ok(null);

    const socket = socketRef.current;
    activeStrokeRef.current = null;

    if (!socket?.connected) {
      pendingPointsRef.current = [];
      return fail('NOT_CONNECTED', 'Koneksi terputus sebelum stroke selesai');
    }

    flushPendingPointsRef.current();
    socket.emit('stroke:end', { roomId: active.roomId, strokeId: active.id });

    const stroke = strokesRef.current.get(active.id);
    if (stroke) {
      const finishedAt = Date.now();
      strokesRef.current.set(active.id, { ...stroke, finishedAt, updatedAt: finishedAt });
      scheduleCommit();
    }

    return ok(null);
  }, [scheduleCommit]);

  const sendCursor = useMemo(
    () =>
      createThrottle((x: number, y: number) => {
        if (!socketRef.current?.connected) return;
        socketRef.current.emit('cursor:move', { roomId, x, y });
      }, CURSOR_THROTTLE_MS),
    [roomId],
  );

  useEffect(() => () => sendCursor.cancel(), [sendCursor]);

  const clearBoard = useCallback(async (): Promise<Result<null>> => {
    const socket = socketRef.current;
    if (!socket?.connected) return fail('NOT_CONNECTED', 'Belum terhubung ke server');

    const response = await emitAck<BoardClearResult>((ack) =>
      socket.emit('board:clear', { roomId }, ack),
    );

    if (!response.ok) {
      setError(response.error);
      return fail(response.error.code, response.error.message, response.error.details);
    }

    // State lokal dibersihkan lewat broadcast `board:cleared` (termasuk ke self).
    return ok(null);
  }, [roomId]);

  const actions = useMemo<WhiteboardActions>(
    () => ({ startStroke, extendStroke, endStroke, sendCursor, clearBoard }),
    [startStroke, extendStroke, endStroke, sendCursor, clearBoard],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    selfId,
    members,
    strokes,
    cursors,
    revision,
    error,
    actions,
    clearError,
  };
}
