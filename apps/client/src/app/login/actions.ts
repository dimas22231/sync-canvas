'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { signIn, signOut } from '@/auth';

const emailSchema = z
  .string()
  .trim()
  .email('Format email tidak valid.')
  .transform((value) => value.toLowerCase());

function errorRedirect(type: string): never {
  redirect(`/login?error=${encodeURIComponent(type)}`);
}

export async function loginWithGoogleAction(): Promise<void> {
  try {
    await signIn('google', { redirectTo: '/' });
  } catch (error) {
    if (error instanceof AuthError) {
      errorRedirect(error.type);
    }
    throw error;
  }
}

export async function loginWithDevAction(formData: FormData): Promise<void> {
  const parsed = emailSchema.safeParse(formData.get('email'));

  if (!parsed.success) {
    errorRedirect('InvalidEmail');
  }

  try {
    await signIn('dev', {
      email: parsed.data,
      redirectTo: '/',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      errorRedirect(error.type);
    }
    throw error;
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
