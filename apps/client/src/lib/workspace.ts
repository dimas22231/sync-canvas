import 'server-only';

import { and, eq } from 'drizzle-orm';
import {
  boards,
  db,
  workspaceMembers,
  workspaces,
  type Board,
  type Workspace,
  type WorkspaceRole,
} from '@synccanvas/db';
import { getDefaultWorkspaceConfig } from '@/lib/access';

export interface WorkspaceAccess {
  workspace: Workspace;
  role: WorkspaceRole;
}

export interface BoardAccess extends WorkspaceAccess {
  board: Board;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Idempotent: memastikan workspace default dan membership user ada.
 * Pengguna pertama workspace menjadi OWNER; pengguna allowlisted berikutnya
 * otomatis menjadi MEMBER.
 */
export async function ensureDefaultWorkspace(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): Promise<WorkspaceAccess> {
  const config = getDefaultWorkspaceConfig();

  const [inserted] = await db
    .insert(workspaces)
    .values({
      name: config.name,
      slug: config.slug,
      createdBy: user.id,
    })
    .onConflictDoNothing({ target: workspaces.slug })
    .returning();

  const workspace =
    inserted ??
    (await db.select().from(workspaces).where(eq(workspaces.slug, config.slug)).limit(1))[0];

  if (!workspace) {
    throw new Error(`Gagal menyiapkan workspace default "${config.slug}".`);
  }

  const [existingMember] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, user.id)),
    )
    .limit(1);

  const role: WorkspaceRole =
    existingMember?.role ?? (workspace.createdBy === user.id ? 'OWNER' : 'MEMBER');

  if (!existingMember) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role })
      .onConflictDoNothing();
  }

  return { workspace, role };
}

export async function getWorkspaceAccess(
  slug: string,
  userId: string,
): Promise<WorkspaceAccess | null> {
  const [row] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(workspaces.slug, slug))
    .limit(1);

  return row ?? null;
}

export async function getBoardAccess(
  slug: string,
  boardId: string,
  userId: string,
): Promise<BoardAccess | null> {
  if (!isUuid(boardId)) {
    return null;
  }

  const access = await getWorkspaceAccess(slug, userId);
  if (!access) {
    return null;
  }

  const [board] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, access.workspace.id)))
    .limit(1);

  return board ? { ...access, board } : null;
}
