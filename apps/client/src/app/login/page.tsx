import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getDefaultWorkspaceConfig, hasGoogleProvider, isDevLoginEnabled } from '@/lib/access';
import { loginWithDevAction, loginWithGoogleAction } from './actions';

export const metadata: Metadata = {
  title: 'Masuk — SyncCanvas',
  description: 'Akses internal SyncCanvas.',
};

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'Email Anda tidak ada di allowlist workspace ini.',
  InvalidEmail: 'Masukkan alamat email yang valid.',
  CredentialsSignin: 'Login development ditolak. Periksa allowlist dan AUTH_DEV_LOGIN.',
  Configuration: 'Konfigurasi autentikasi belum lengkap. Hubungi administrator.',
  Verification: 'Tautan verifikasi tidak valid atau sudah kedaluwarsa.',
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user?.id) {
    redirect(`/w/${getDefaultWorkspaceConfig().slug}`);
  }

  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? 'Login gagal. Silakan coba lagi.') : null;
  const googleEnabled = hasGoogleProvider();
  const devEnabled = isDevLoginEnabled();

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <a className="brand" href="/login" aria-label="SyncCanvas">
          <span className="brand-mark">SC</span>
          <span>
            <h1>SyncCanvas</h1>
            <p>Whiteboard kolaboratif internal</p>
          </span>
        </a>

        <div className="auth-copy">
          <p className="eyebrow">Akses terbatas</p>
          <h2>Ruang kerja untuk tim yang bergerak cepat.</h2>
          <p>
            Gambar, berdiskusi, dan susun ide di satu papan. Hanya anggota yang diizinkan yang dapat
            masuk ke workspace.
          </p>
        </div>

        <ul className="auth-points">
          <li>Workspace internal dengan kontrol akses email</li>
          <li>Board per proyek dalam satu tempat</li>
          <li>Fondasi realtime Socket.io untuk sprint berikutnya</li>
        </ul>
      </section>

      <section className="auth-panel" aria-labelledby="login-heading">
        <div className="auth-card">
          <div className="auth-card-header">
            <p className="eyebrow">Selamat datang kembali</p>
            <h2 id="login-heading">Masuk ke workspace</h2>
            <p className="muted">Gunakan akun Google yang sudah diizinkan.</p>
          </div>

          {errorMessage ? (
            <div className="form-error" role="alert">
              {errorMessage}
            </div>
          ) : null}

          {googleEnabled ? (
            <form action={loginWithGoogleAction}>
              <button className="google-button" type="submit">
                <span className="google-mark" aria-hidden="true">
                  G
                </span>
                Lanjutkan dengan Google
              </button>
            </form>
          ) : (
            <div className="setup-warning">
              <strong>Google OAuth belum dikonfigurasi.</strong>
              <p>
                Isi <code>AUTH_GOOGLE_ID</code> dan <code>AUTH_GOOGLE_SECRET</code> untuk
                mengaktifkan login Google.
              </p>
            </div>
          )}

          {devEnabled ? (
            <div className="dev-login">
              <div className="divider">
                <span>Development only</span>
              </div>
              <p className="muted">
                Login cepat tanpa Google OAuth. Hanya aktif saat <code>AUTH_DEV_LOGIN=true</code>{' '}
                dan bukan production.
              </p>
              <form action={loginWithDevAction} className="dev-login-form">
                <label>
                  Email allowlisted
                  <input
                    type="email"
                    name="email"
                    placeholder="nama@perusahaan.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <button className="secondary-button" type="submit">
                  Masuk sebagai developer
                </button>
              </form>
            </div>
          ) : null}

          <p className="auth-legal">
            Dengan masuk, Anda menyetujui penggunaan internal SyncCanvas. Sesi berlaku maksimal 7
            hari.
          </p>
        </div>
      </section>
    </main>
  );
}
