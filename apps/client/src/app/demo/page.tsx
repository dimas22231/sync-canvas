import type { Metadata } from 'next';
import { WhiteboardDemo } from '@/components/whiteboard-demo';
import { requireUser } from '@/lib/require-user';

export const metadata: Metadata = {
  title: 'Prototipe Realtime — SyncCanvas',
};

export default async function DemoPage() {
  await requireUser();

  return (
    <main className="page">
      <WhiteboardDemo />
    </main>
  );
}
