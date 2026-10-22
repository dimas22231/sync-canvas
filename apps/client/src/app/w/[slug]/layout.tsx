import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDefaultWorkspaceConfig } from '@/lib/access';
import { requireUser } from '@/lib/require-user';
import { ensureDefaultWorkspace, getWorkspaceAccess } from '@/lib/workspace';
import { signOutAction } from '@/app/login/actions';

interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

function initials(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0] || '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { slug } = await params;
  const user = await requireUser();
  const defaultWorkspace = getDefaultWorkspaceConfig();

  if (slug === defaultWorkspace.slug) {
    await ensureDefaultWorkspace(user);
  }

  const access = await getWorkspaceAccess(slug, user.id);
  if (!access) {
    notFound();
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="brand compact" href={`/w/${slug}`}>
          <span className="brand-mark">SC</span>
          <span>
            <h1>SyncCanvas</h1>
            <p>{access.workspace.name}</p>
          </span>
        </Link>

        <nav className="app-nav" aria-label="Navigasi workspace">
          <Link className="nav-item active" href={`/w/${slug}`}>
            <span className="nav-icon" aria-hidden="true">
              ▦
            </span>
            Boards
          </Link>
          <Link className="nav-item" href="/demo">
            <span className="nav-icon" aria-hidden="true">
              ✎
            </span>
            Prototipe realtime
          </Link>
        </nav>

        <div className="sidebar-role">
          <span className="role-label">Akses Anda</span>
          <span className="role-value">{access.role === 'OWNER' ? 'Owner' : 'Member'}</span>
        </div>

        <div className="app-sidebar-footer">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">
              {initials(user.name, user.email)}
            </span>
            <span className="user-meta">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </span>
          </div>
          <form action={signOutAction}>
            <button className="ghost-button full-width" type="submit">
              Keluar
            </button>
          </form>
        </div>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
