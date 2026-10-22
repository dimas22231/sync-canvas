import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { boards, db } from '@synccanvas/db';
import { requireUser } from '@/lib/require-user';
import { getWorkspaceAccess } from '@/lib/workspace';
import { createBoardAction, deleteBoardAction, renameBoardAction } from './actions';

export const metadata: Metadata = {
  title: 'Boards — SyncCanvas',
};

const LIST_ERRORS: Record<string, string> = {
  title: 'Judul board harus 1–80 karakter.',
  forbidden: 'Hanya owner atau pembuat board yang dapat mengubah board ini.',
  create: 'Board gagal dibuat. Coba lagi.',
};

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface WorkspacePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function WorkspacePage({ params, searchParams }: WorkspacePageProps) {
  const { slug } = await params;
  const user = await requireUser();
  const access = await getWorkspaceAccess(slug, user.id);

  if (!access) {
    notFound();
  }

  const { error } = await searchParams;
  const errorMessage = error ? LIST_ERRORS[error] : undefined;

  const workspaceBoards = await db
    .select()
    .from(boards)
    .where(eq(boards.workspaceId, access.workspace.id))
    .orderBy(desc(boards.updatedAt));

  return (
    <div className="workspace-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Boards</h1>
          <p className="page-subtitle">
            Kumpulkan papan untuk proyek, diskusi, dan perencanaan tim.
          </p>
        </div>

        <form className="new-board-form" action={createBoardAction}>
          <input type="hidden" name="slug" value={slug} />
          <label className="sr-only" htmlFor="new-board-title">
            Judul board baru
          </label>
          <input
            id="new-board-title"
            name="title"
            placeholder="Judul board baru…"
            maxLength={80}
            required
          />
          <button className="primary-button compact" type="submit">
            Buat board
          </button>
        </form>
      </header>

      {errorMessage ? (
        <div className="form-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <section className="workspace-summary" aria-label="Ringkasan workspace">
        <div>
          <span className="summary-label">Total board</span>
          <strong>{workspaceBoards.length}</strong>
        </div>
        <div>
          <span className="summary-label">Peran Anda</span>
          <strong>{access.role === 'OWNER' ? 'Owner' : 'Member'}</strong>
        </div>
        <div>
          <span className="summary-label">Status editor</span>
          <strong className="summary-status">Sprint 2</strong>
        </div>
      </section>

      {workspaceBoards.length === 0 ? (
        <section className="empty-state">
          <span className="empty-mark" aria-hidden="true">
            ▦
          </span>
          <h2>Belum ada board</h2>
          <p>
            Buat board pertama untuk mulai mengorganisasi ide. Editor realtime akan tersambung pada
            sprint berikutnya.
          </p>
        </section>
      ) : (
        <section className="board-grid" aria-label="Daftar board">
          {workspaceBoards.map((board, index) => (
            <article className="board-card" key={board.id}>
              <Link className="board-card-link" href={`/w/${slug}/b/${board.id}`}>
                <span className={`board-thumb thumb-${(index % 3) + 1}`} aria-hidden="true">
                  <span className="thumb-line" />
                  <span className="thumb-line short" />
                  <span className="thumb-dot" />
                </span>
                <span className="board-card-body">
                  <span className="board-title">{board.title}</span>
                  <span className="board-meta">
                    Diperbarui {dateFormatter.format(board.updatedAt)}
                  </span>
                </span>
              </Link>

              <details className="board-menu">
                <summary aria-label={`Opsi untuk ${board.title}`}>⋯</summary>
                <div className="board-menu-panel">
                  <form action={renameBoardAction} className="menu-form">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="boardId" value={board.id} />
                    <label>
                      Ubah judul
                      <input name="title" defaultValue={board.title} maxLength={80} required />
                    </label>
                    <button className="secondary-button small" type="submit">
                      Simpan
                    </button>
                  </form>
                  <form action={deleteBoardAction} className="menu-form">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="boardId" value={board.id} />
                    <button className="danger-button" type="submit">
                      Hapus board
                    </button>
                  </form>
                </div>
              </details>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
