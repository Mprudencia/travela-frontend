'use client';

import { apiErrorMessage, apiResponseMessage, AuthApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  ArrowRight,
  CheckCircle,
  HelpCircle,
  Loader2,
  Mail,
  RefreshCw,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

const OTP_MAX_ATTEMPTS = 5;
const SUPPORT_EMAIL = 'hello@onnelalimited.com';

function VerifyEmailContent() {
  const { isAuthenticated, isLoading, user, markEmailVerified, refreshUser } =
    useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const redirect = useMemo(() => {
    const raw = params.get('redirect');
    if (!raw) return '/dashboard';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
  }, [params]);

  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [resendCooldownEndsAt, setResendCooldownEndsAt] = useState(0);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const [done, setDone] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const dest = `/auth/verify-email?redirect=${encodeURIComponent(redirect)}`;
      router.replace(`/auth/login?redirect=${encodeURIComponent(dest)}`);
    }
  }, [isAuthenticated, isLoading, router, redirect]);

  useEffect(() => {
    if (user?.email_verified === true) {
      setDone(true);
    }
  }, [user?.email_verified]);

  useEffect(() => {
    const msLeft = Math.max(0, resendCooldownEndsAt - Date.now());
    setResendSecondsLeft(Math.ceil(msLeft / 1000));
    if (msLeft <= 0) return;
    const id = window.setInterval(() => {
      const left = Math.max(0, resendCooldownEndsAt - Date.now());
      setResendSecondsLeft(Math.ceil(left / 1000));
      if (left <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [resendCooldownEndsAt]);

  const email = typeof user?.email === 'string' ? user.email : '';

  const handleVerify = async () => {
    if (attempts >= OTP_MAX_ATTEMPTS) {
      setError(
        'Too many failed attempts. Resend a new code or contact support below.'
      );
      setShowHelp(true);
      return;
    }

    const normalized = otp.replace(/\D/g, '').trim();
    if (!/^\d{6}$/.test(normalized)) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    if (!email) {
      setError('No email on your account. Please contact support.');
      setShowHelp(true);
      return;
    }

    setError('');
    setInfo('');
    setVerifying(true);
    try {
      const verifyRes = await AuthApi.verifyEmail({
        email,
        code: normalized,
      });
      if (!verifyRes.ok) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= OTP_MAX_ATTEMPTS) {
          setError(
            'Too many failed attempts. Resend a new code or contact support below.'
          );
          setShowHelp(true);
        } else {
          setError(
            apiErrorMessage(
              verifyRes.body,
              `Verification failed (HTTP ${verifyRes.status}).`
            ) +
              ` (${OTP_MAX_ATTEMPTS - newAttempts} attempt${
                OTP_MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'
              } remaining)`
          );
        }
        return;
      }

      markEmailVerified();
      await refreshUser();
      setDone(true);
      setInfo('Email verified successfully.');
    } catch (e: unknown) {
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setError(fallback || 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendSecondsLeft > 0) return;
    setError('');
    setInfo('');
    setResending(true);
    try {
      const res = await AuthApi.resendVerificationEmail();
      if (!res.ok) {
        setError(
          apiErrorMessage(res.body, `Could not resend code (HTTP ${res.status}).`)
        );
        setShowHelp(true);
        return;
      }
      setAttempts(0);
      setOtp('');
      setInfo(
        apiResponseMessage(res.body, 'Verification code sent to your email.')
      );
      setResendCooldownEndsAt(Date.now() + 30_000);
    } catch (e: unknown) {
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setError(fallback || 'Could not resend code.');
      setShowHelp(true);
    } finally {
      setResending(false);
    }
  };

  const supportMailto = useMemo(() => {
    const subject = encodeURIComponent('Travela email verification help');
    const body = encodeURIComponent(
      `Hi Travela support,\n\nI cannot verify my email.\nAccount email: ${email || '(unknown)'}\n\nPlease help me complete verification.\n`
    );
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }, [email]);

  if (isLoading || !isAuthenticated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ backgroundColor: '#f6f8f6' }}
    >
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Image
              src="/logos/travela_dark.png"
              alt="Travela"
              width={120}
              height={38}
              className="h-9 w-auto object-contain"
            />
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center">
          {done ? (
            <>
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'rgba(23,207,84,0.12)' }}
              >
                <CheckCircle size={28} style={{ color: '#17cf54' }} />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 mb-2">
                Email verified
              </h1>
              <p className="text-sm text-slate-500 mb-6">
                {email ? (
                  <>
                    <span className="font-semibold text-slate-700">{email}</span> is
                    confirmed. You&apos;re all set.
                  </>
                ) : (
                  'Your email is confirmed. You are all set.'
                )}
              </p>
              <button
                type="button"
                onClick={() => router.replace(redirect)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white hover:opacity-90"
                style={{ backgroundColor: '#112116' }}
              >
                Continue <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'rgba(17,33,22,0.08)' }}
              >
                <Mail size={26} style={{ color: '#112116' }} />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 mb-2">
                Verify your email
              </h1>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                Enter the 6-digit code we sent to{' '}
                <span className="font-semibold text-slate-700">
                  {email || 'your email'}
                </span>
                .
              </p>

              <div className="text-left mb-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
                  Verification Code
                </label>
                <input
                  type="text"
                  placeholder="Enter code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-lg font-bold text-slate-900 tracking-[0.3em] text-center placeholder-slate-300 focus:outline-none focus:border-slate-400"
                />
                {info && !error && (
                  <p className="text-xs font-medium text-emerald-700 mt-2">{info}</p>
                )}
                {error && (
                  <p className="text-xs font-medium text-red-600 mt-2">{error}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={
                  verifying ||
                  !/^\d{6}$/.test(otp.trim()) ||
                  attempts >= OTP_MAX_ATTEMPTS
                }
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 hover:opacity-90"
                style={{ backgroundColor: '#112116' }}
              >
                {verifying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    Verify email <ArrowRight size={16} />
                  </>
                )}
              </button>

              <div className="flex items-center justify-between mt-4 gap-3">
                <button
                  type="button"
                  onClick={() => void handleResend()}
                  disabled={resending || resendSecondsLeft > 0}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  <RefreshCw size={12} />
                  {resending
                    ? 'Sending…'
                    : resendSecondsLeft > 0
                      ? `Resend code (${resendSecondsLeft}s)`
                      : 'Resend code'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowHelp((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
                >
                  <HelpCircle size={12} />
                  Code not working?
                </button>
              </div>
            </>
          )}
        </div>

        {!done && showHelp && (
          <div className="mt-4 bg-white rounded-2xl border border-slate-200 p-5 text-left">
            <p className="text-sm font-bold text-slate-900 mb-2">Backup options</p>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>Check spam/junk — codes can land there.</li>
              <li>
                Use <span className="font-semibold">Resend code</span> for a fresh
                6-digit code (resets failed attempts).
              </li>
              <li>
                Wrong email? Use{' '}
                <Link href="/profile" className="font-semibold underline">
                  Profile → Account email
                </Link>{' '}
                to continue with a new email (same name and password), then verify
                that address.
              </li>
            </ul>
            <a
              href={supportMailto}
              className="mt-4 inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-800 hover:bg-slate-50"
            >
              Email support ({SUPPORT_EMAIL})
            </a>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          <Link href="/dashboard" className="hover:text-slate-600">
            Back to dashboard
          </Link>
          {' · '}
          <Link href="/profile" className="hover:text-slate-600">
            Profile
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: '#f6f8f6' }}
        >
          <Loader2 className="animate-spin text-slate-400" size={28} />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
