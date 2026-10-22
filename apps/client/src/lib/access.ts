const DEV_ONLY_TRUE = 'true';

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Allowlist fail-closed: jika tidak ada email/domain yang dikonfigurasi,
 * semua login ditolak. Ini mencegah deployment tanpa konfigurasi akses
 * berubah menjadi aplikasi publik.
 */
export function isEmailAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    return false;
  }

  const allowedEmails = parseList(process.env.ALLOWED_EMAILS);
  const allowedDomains = parseList(process.env.ALLOWED_EMAIL_DOMAINS).map((domain) =>
    domain.replace(/^@/, ''),
  );

  if (allowedEmails.length === 0 && allowedDomains.length === 0) {
    return false;
  }

  if (allowedEmails.includes(normalized)) {
    return true;
  }

  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return allowedDomains.includes(domain);
}

export function hasGoogleProvider(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/**
 * Login kredensial hanya untuk development. Dua guard dipakai sekaligus:
 * NODE_ENV bukan production dan flag eksplisit AUTH_DEV_LOGIN=true.
 */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_LOGIN === DEV_ONLY_TRUE;
}

export function getDefaultWorkspaceConfig(): { slug: string; name: string } {
  return {
    slug: process.env.DEFAULT_WORKSPACE_SLUG?.trim() || 'internal',
    name: process.env.DEFAULT_WORKSPACE_NAME?.trim() || 'SyncCanvas Internal',
  };
}
