'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { boards, db } from '@synccanvas/db';
import { requireUser } from '@/lib/require-user';
import { getBoardAccess, getWorkspaceAccess } from '@/lib/workspace';

const boardTitleSchema = z
  .string()
  .trim()
  .min(1, 'Judul board wajib diisi.')
  .max(80, 'Judul board maksimal 80 karakter.');

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function canManageBoard(role: 'OWNER' | 'MEMBER', createdBy: string, userId: string): boolean {
  return role === 'OWNER' || createdBy === userId;
}

export async function createBoardAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = readField(formData, 'slug');
  const parsedTitle = boardTitleSchema.safeParse(formData.get('title'));

  if (!slug) {
    redirect('/');
  }

  if (!parsedTitle.success) {
    redirect(`/w/${slug}?error=title`);
  }

  const access = await getWorkspaceAccess(slug, user.id);
  if (!access) {
    notFound();
  }

  const [board] = await db
    .insert(boards)
    .values({
      workspaceId: access.workspace.id,
      title: parsedTitle.data,
      createdBy: user.id,
    })
    .returning();

  if (!board) {
    redirect(`/w/${slug}?error=create`);
  }

  revalidatePath(`/w/${slug}`);
  redirect(`/w/${slug}/b/${board.id}`);
}

export async function renameBoardAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = readField(formData, 'slug');
  const boardId = readField(formData, 'boardId');
  const parsedTitle = boardTitleSchema.safeParse(formData.get('title'));

  if (!slug || !boardId) {
    redirect('/');
  }

  if (!parsedTitle.success) {
    redirect(`/w/${slug}?error=title`);
  }

  const access = await getBoardAccess(slug, boardId, user.id);
  if (!access) {
    notFound();
  }

  if (!canManageBoard(access.role, access.board.createdBy, user.id)) {
    redirect(`/w/${slug}?error=forbidden`);
  }

  await db
    .update(boards)
    .set({ title: parsedTitle.data, updatedAt: new Date() })
    .where(and(eq(boards.id, access.board.id), eq(boards.workspaceId, access.workspace.id)));

  revalidatePath(`/w/${slug}`);
  revalidatePath(`/w/${slug}/b/${access.board.id}`);
}

export async function deleteBoardAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = readField(formData, 'slug');
  const boardId = readField(formData, 'boardId');

  if (!slug || !boardId) {
    redirect('/');
  }

  const access = await getBoardAccess(slug, boardId, user.id);
  if (!access) {
    notFound();
  }

  if (!canManageBoard(access.role, access.board.createdBy, user.id)) {
    redirect(`/w/${slug}?error=forbidden`);
  }

  await db.delete(boards).where(eq(boards.id, access.board.id));

  revalidatePath(`/w/${slug}`);
  redirect(`/w/${slug}`);
}
