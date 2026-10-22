import 'server-only';

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { accounts, db, sessions, users, verificationTokens } from '@synccanvas/db';
import { isDevLoginEnabled, isEmailAllowed } from '@/lib/access';

const devCredentials = Credentials({
  id: 'dev',
  name: 'Development login',
  credentials: {
    email: { label: 'Email', type: 'email' },
  },
  async authorize(credentials) {
    if (!isDevLoginEnabled()) {
      return null;
    }

    const email =
      typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';

    if (!email || !isEmailAllowed(email)) {
      return null;
    }

    // Credentials provider tidak mengelola user secara otomatis, jadi user
    // allowlisted dibuat/di-update manual di sini.
    const [user] = await db
      .insert(users)
      .values({
        email,
        name: email.split('@')[0] ?? 'Anggota',
        emailVerified: new Date(),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { emailVerified: new Date() },
      })
      .returning();

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    // Wajib untuk Credentials provider. User Google tetap dipersistenkan
    // lewat Drizzle adapter; hanya session state yang disimpan di JWT.
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7,
  },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: '/login',
  },
  providers: [Google, devCredentials],
  callbacks: {
    async signIn({ user }) {
      return Boolean(user.email && isEmailAllowed(user.email));
    },
    async jwt({ token, user }) {
      if (user) {
        token.name = user.name;
        token.email = user.email;
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.name = token.name ?? session.user.name;
        session.user.email = token.email ?? session.user.email;
        session.user.image = typeof token.picture === 'string' ? token.picture : session.user.image;
      }
      return session;
    },
  },
});
