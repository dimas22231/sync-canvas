import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getDefaultWorkspaceConfig } from '@/lib/access';
import { ensureDefaultWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.email) {
    redirect('/login');
  }

  await ensureDefaultWorkspace({
    id: user.id,
    name: user.name,
    email: user.email,
  });

  redirect(`/w/${getDefaultWorkspaceConfig().slug}`);
}
