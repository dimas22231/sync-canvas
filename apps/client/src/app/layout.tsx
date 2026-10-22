import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'SyncCanvas — Whiteboard Kolaboratif Real-Time',
  description:
    'Whiteboard kolaboratif real-time berbasis Next.js, Node.js, dan Socket.io. Gambar bersama, lihat kursor peserta lain, dan sinkronkan board tanpa refresh.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
