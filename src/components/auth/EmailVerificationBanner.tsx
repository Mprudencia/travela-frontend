'use client';

import { useAuth } from '@/lib/auth-context';
import { AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

type Props = {
  /** Compact inline card (profile) vs full-width bar (dashboard). */
  variant?: 'bar' | 'card';
  className?: string;
};

export default function EmailVerificationBanner({
  variant = 'bar',
  className = '',
}: Props) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated || !user) return null;
  if (user.email_verified === true) return null;

  const verifyHref = '/auth/verify-email';

  if (variant === 'card') {
    return (
      <div
        className={`rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 ${className}`}
      >
        <div className="flex gap-3">
          <AlertCircle
            size={20}
            className="shrink-0 mt-0.5 text-amber-700"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-950">Email not verified</p>
            <p className="text-sm text-amber-900/80 mt-0.5">
              {user.email
                ? `Confirm ${user.email} so we can secure your account and send eSIM details.`
                : 'Confirm your email so we can secure your account and send eSIM details.'}
            </p>
            <Link
              href={verifyHref}
              className="inline-flex items-center gap-1.5 mt-3 text-sm font-bold text-amber-950 hover:underline"
            >
              Verify email <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-amber-50 border-b border-amber-200 px-4 py-3 ${className}`}>
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-sm text-amber-950 flex items-start sm:items-center gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5 sm:mt-0 text-amber-700" />
          <span>
            Your email is not verified
            {user.email ? (
              <>
                {' '}
                (<span className="font-semibold">{user.email}</span>)
              </>
            ) : null}
            . Verify it to finish account setup.
          </span>
        </p>
        <Link
          href={verifyHref}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white hover:opacity-90"
          style={{ backgroundColor: '#112116' }}
        >
          Verify now <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
