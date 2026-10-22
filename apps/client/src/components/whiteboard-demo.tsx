'use client';

import { useRef, useState, type FormEvent, type PointerEvent } from 'react';
import type { Point } from '@synccanvas/shared';
import { useWhiteboardSocket, type ConnectionStatus } from '@/hooks/use-whiteboard-socket';

/** Ukuran bidang virtual; koordinat disimpan dalam unit ini, bukan pixel layar. */
const BOARD_WIDTH = 1000;
const BOARD_HEIGHT = 600;

const COLORS = ['#7c9cff', '#4ade80', '#f472b6', '#facc15', '#f8fafc'] as const;
const TOOLS = [
  { id: 'pen', label: 'Pen' },
  { id: 'highlighter', label: 'Highlighter' },
] as const;

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: 'Menganggur',
  connecting: 'Menghubungkan…',
  connected: 'Terhubung',
  reconnecting: 'Menyambung ulang…',
  error: 'Terputus',
};

/**
 * Demo whiteboard end-to-end.
 *
 * Komponen ini sengaja tipis: seluruh logika jaringan ada di
 * `useWhiteboardSocket`, sedangkan komponen hanya mengurus input pointer dan
 * rendering SVG. Pola yang sama bisa dipakai untuk canvas 2D/WebGL di produksi.
 */
export function WhiteboardDemo() {
  const [roomInput, setRoomInput] = useState('demo-room');
  const [nameInput, setNameInput] = useState('');
  const [joined, setJoined] = useState(false);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [tool, setTool] = useState<(typeof TOOLS)[number]['id']>('pen');
  const [width, setWidth] = useState(3);

  const drawingRef = useRef(false);

  const { status, selfId, members, strokes, cursors, revision, error, actions, clearError } =
    useWhiteboardSocket({
      roomId: roomInput,
      displayName: nameInput,
      enabled: joined,
    });

  const isConnected = status === 'connected';

  const handleJoin = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const roomId = roomInput.trim().toLowerCase();
    const displayName = nameInput.trim();
    if (!roomId || !displayName) return;

    setRoomInput(roomId);
    setNameInput(displayName);
    setJoined(true);
  };

  const toBoardPoint = (event: PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * BOARD_WIDTH * 10) / 10,
      y: Math.round(((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT * 10) / 10,
    };
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (!isConnected) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;

    void actions.startStroke({
      tool,
      color,
      width,
      point: toBoardPoint(event),
    });
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (!isConnected) return;
    const point = toBoardPoint(event);

    actions.sendCursor(point.x, point.y);
    if (drawingRef.current) actions.extendStroke([point]);
  };

  const finishStroke = (): void => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    void actions.endStroke();
  };

  if (!joined) {
    return (
      <section className="join-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            SC
          </span>
          <div>
            <h1>SyncCanvas</h1>
            <p>Whiteboard kolaboratif real-time.</p>
          </div>
        </div>

        <form className="join-form" onSubmit={handleJoin}>
          <label>
            Nama tampilan
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="mis. Rani"
              maxLength={32}
              autoComplete="nickname"
              required
            />
          </label>

          <label>
            Room
            <input
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
              placeholder="mis. design-sprint"
              pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
              title="3-64 karakter: huruf kecil, angka, atau tanda hubung"
              maxLength={64}
              required
            />
            <span className="field-hint">
              Huruf kecil, angka, dan tanda hubung (3-64 karakter).
            </span>
          </label>

          <button type="submit" className="primary-button">
            Masuk ke board
          </button>
        </form>

        <p className="join-footnote">
          Buka tab atau perangkat lain, lalu masuk dengan nama room yang sama untuk melihat
          sinkronisasi coretan dan kursor.
        </p>
      </section>
    );
  }

  return (
    <section className="board-shell">
      <aside className="sidebar">
        <div className="brand compact">
          <span className="brand-mark" aria-hidden="true">
            SC
          </span>
          <div>
            <h1>SyncCanvas</h1>
            <p>real-time board</p>
          </div>
        </div>

        <div className="room-badge">
          <span className="room-label">Room</span>
          <strong>{roomInput}</strong>
        </div>

        <div className="sidebar-section">
          <h2>Peserta · {members.length}</h2>
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.id}>
                <span className="member-dot" style={{ backgroundColor: member.color }} />
                <span className="member-name">{member.displayName}</span>
                {member.id === selfId ? <span className="you-tag">Anda</span> : null}
              </li>
            ))}
          </ul>
          {members.length === 0 ? <p className="muted">Menunggu data room…</p> : null}
        </div>

        <div className="sidebar-section">
          <h2>Board</h2>
          <dl className="board-stats">
            <div>
              <dt>Stroke</dt>
              <dd>{strokes.length}</dd>
            </div>
            <div>
              <dt>Revisi</dt>
              <dd>{revision}</dd>
            </div>
            <div>
              <dt>Kursor</dt>
              <dd>{cursors.length}</dd>
            </div>
          </dl>
        </div>

        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            setJoined(false);
            drawingRef.current = false;
          }}
        >
          Keluar room
        </button>
      </aside>

      <div className="stage">
        <header className="stage-header">
          <div className={`status-pill status-${status}`}>
            <span className="status-dot" aria-hidden="true" />
            {STATUS_LABEL[status]}
          </div>

          <div className="toolbar" role="toolbar" aria-label="Alat menggambar">
            <div className="swatches">
              {COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={swatch === color ? 'swatch active' : 'swatch'}
                  style={{ backgroundColor: swatch }}
                  aria-label={`Warna ${swatch}`}
                  aria-pressed={swatch === color}
                  onClick={() => setColor(swatch)}
                />
              ))}
            </div>

            <div className="segmented">
              {TOOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tool === item.id ? 'segment active' : 'segment'}
                  onClick={() => setTool(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="width-control">
              <span>Ketebalan</span>
              <input
                type="range"
                min={1}
                max={14}
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
              />
            </label>

            <button
              type="button"
              className="danger-button"
              disabled={!isConnected || strokes.length === 0}
              onClick={() => void actions.clearBoard()}
            >
              Bersihkan
            </button>
          </div>
        </header>

        {error ? (
          <div className="alert" role="alert">
            <span>{error.message}</span>
            <button type="button" onClick={clearError} aria-label="Tutup peringatan">
              ×
            </button>
          </div>
        ) : null}

        <div className="board-frame">
          <svg
            className="board"
            viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
            preserveAspectRatio="none"
            role="application"
            aria-label="Whiteboard kolaboratif. Gambar dengan mouse atau stylus."
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
          >
            <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#0b101a" />
            <g className="grid" aria-hidden="true">
              {Array.from({ length: 19 }, (_, index) => (
                <line
                  key={`v-${index}`}
                  x1={(index + 1) * 50}
                  y1={0}
                  x2={(index + 1) * 50}
                  y2={BOARD_HEIGHT}
                />
              ))}
              {Array.from({ length: 11 }, (_, index) => (
                <line
                  key={`h-${index}`}
                  x1={0}
                  y1={(index + 1) * 50}
                  x2={BOARD_WIDTH}
                  y2={(index + 1) * 50}
                />
              ))}
            </g>

            {strokes.map((stroke) =>
              stroke.points.length === 1 ? (
                <circle
                  key={stroke.id}
                  cx={stroke.points[0]?.x}
                  cy={stroke.points[0]?.y}
                  r={stroke.width / 2}
                  fill={stroke.color}
                  opacity={stroke.tool === 'highlighter' ? 0.45 : 1}
                />
              ) : (
                <polyline
                  key={stroke.id}
                  points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={stroke.tool === 'highlighter' ? 0.45 : 1}
                />
              ),
            )}

            {cursors.map((cursor) => (
              <g
                key={cursor.memberId}
                transform={`translate(${cursor.x} ${cursor.y})`}
                aria-hidden="true"
              >
                <circle r={7} fill="#0b101a" opacity={0.85} />
                <circle r={5} fill="#f8fafc" />
                <circle r={2.5} fill="#7c9cff" />
              </g>
            ))}
          </svg>
        </div>

        <p className="stage-hint">
          Gambar langsung di area board. Kursor peserta lain tampil sebagai titik putih. Semua
          coretan tersimpan di memori server selama room aktif.
        </p>
      </div>
    </section>
  );
}
