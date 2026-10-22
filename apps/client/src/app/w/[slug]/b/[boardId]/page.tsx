import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { count, eq } from 'drizzle-orm';
import { boardElements, db } from '@synccanvas/db';
import { requireUser } from '@/lib/require-user';
import { getBoardAccess } from '@/lib/workspace';

export const metadata: Metadata = {
  title: 'Board — SyncCanvas',
};

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeStyle: 'short',
});

interface BoardPageProps {
  params: Promise<{ slug: string; boardId: string }>;
}

export default async function BoardPage({ params }: BoardPageProps) {
  const { slug, boardId } = await params;
  const user = await requireUser();
  const access = await getBoardAccess(slug, boardId, user.id);

  if (!access) {
    notFound();
  }

  const [elementStats] = await db
    .select({ total: count() })
    .from(boardElements)
    .where(eq(boardElements.boardId, access.board.id));

  return (
    <div className="board-view">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href={`/w/${slug}`}>Boards</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{access.board.title}</span>
      </nav>

      <header className="board-page-header">
        <div>
          <p className="eyebrow">Board</p>
          <h1>{access.board.title}</h1>
          <p className="page-subtitle">
            Dibuat {dateFormatter.format(access.board.createdAt)} · {elementStats?.total ?? 0}{' '}
            elemen tersimpan
          </p>
        </div>
        <span className="status-pill">
          <span className="status-dot status-connecting" />
          Editor realtime: Sprint 2
        </span>
      </header>

      <section className="board-stage" aria-label="Pratinjau board">
        <div className="board-stage-grid" aria-hidden="true" />
        <div className="board-stage-content">
          <span className="stage-badge">Fondasi siap</span>
          <h2>Board Anda sudah tersimpan.</h2>
          <p>
            Autentikasi, workspace, dan manajemen board sudah aktif. Koneksi editor realtime,
            penyimpanan coretan, dan sticky note dikerjakan pada sprint berikutnya.
          </p>
          <div className="stage-actions">
            <Link className="primary-button compact" href={`/w/${slug}`}>
              Kembali ke daftar board
            </Link>
            <Link className="secondary-button compact" href="/demo">
              Coba prototipe realtime
            </Link>
          </div>
        </div>
      </section>

      <section className="board-info-grid" aria-label="Detail board">
        <div>
          <span className="summary-label">Workspace</span>
          <strong>{access.workspace.name}</strong>
        </div>
        <div>
          <span className="summary-label">Akses Anda</span>
          <strong>{access.role === 'OWNER' ? 'Owner' : 'Member'}</strong>
        </div>
        <div>
          <span className="summary-label">Terakhir diperbarui</span>
          <strong>{dateFormatter.format(access.board.updatedAt)}</strong>
        </div>
      </section>
    </div>
  );
}
