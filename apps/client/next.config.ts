import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @synccanvas/shared sudah dikompilasi ke ESM + declaration files, jadi
  // tidak perlu transpilePackages. Jalankan `npm run build -w @synccanvas/shared`
  // sebelum `next dev` pertama kali (sudah otomatis lewat `npm run dev` di root).
};

export default nextConfig;
