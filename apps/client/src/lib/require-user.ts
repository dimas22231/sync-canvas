import 'server-only';

import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/**
 * Guard tunggal untuk server component dan server action.
 * Semua halaman terproteksi harus memanggil fungsi ini.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.email) {
    redirect('/login');
  }

  return {
    id: user.id,
    name: user.name ?? user.email.split('@')[0] ?? 'Anggota',
    email: user.email,
    image: user.image ?? null,
  };
}
