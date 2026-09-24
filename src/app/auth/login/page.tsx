'use client';

import { useAuth } from '@/lib/auth-context';
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

function LoginContent() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const redirect = useMemo(() => {
    const raw = params.get('redirect');
    if (!raw) return '/dashboard';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
  }, [params]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const emailParam = params.get('email');
    if (emailParam) setEmail(emailParam);
    if (params.get('passwordSet') === '1') {
      setSuccess('Password set! You can now sign in.');
    }
  }, [params]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      router.replace(redirect);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(
        e?.response?.data?.message ??
          (err instanceof Error ? err.message : undefined) ??
          'Invalid email or password.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left — brand image panel */}
      <div className="relative hidden lg:flex lg:w-1/2 overflow-hidden">
        <Image
          src="/backgrounds/7.jpg"
          alt="Stay connected while you travel"
          fill
          priority
          className="object-cover"
          sizes="50vw"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(160deg, rgba(17,33,22,0.75) 0%, rgba(17,33,22,0.45) 45%, rgba(17,33,22,0.7) 100%)',
          }}
        />
        <div className="relative z-10 flex flex-col justify-between p-10 xl:p-14 w-full text-white">
          <Link href="/" className="inline-flex">
            <Image
              src="/logos/travela_white.png"
              alt="Travela"
              width={140}
              height={44}
              className="h-10 w-auto object-contain"
            />
          </Link>

          <div className="max-w-md">
            <p
              className="text-xs font-bold uppercase tracking-widest mb-3"
              style={{ color: '#17cf54' }}
            >
              Tanzania · Zanzibar · Africa
            </p>
            <h2 className="text-3xl xl:text-4xl font-extrabold leading-tight mb-4">
              Stay connected on every journey
            </h2>
            <p className="text-base text-white/75 leading-relaxed">
              Sign in to manage your eSIM, track data, and top up anytime — no roaming surprises.
            </p>
          </div>

          <p className="text-xs text-white/45">Powered by Onnela Limited</p>
        </div>
      </div>

      {/* Right — form */}
      <div
        className="w-full lg:w-1/2 flex flex-col justify-center px-5 sm:px-10 xl:px-16 py-10"
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <div className="w-full max-w-md mx-auto">
          <div className="lg:hidden mb-8">
            <Link href="/" className="inline-flex">
              <Image
                src="/logos/travela_dark.png"
                alt="Travela"
                width={120}
                height={36}
                className="h-8 w-auto object-contain"
              />
            </Link>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-1 tracking-tight">
            Welcome
          </h1>
          <p className="text-sm text-slate-500 mb-8">Sign in with your email</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                className="block text-xs font-bold uppercase tracking-wide mb-1.5"
                style={{ color: '#112116' }}
              >
                Email
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 transition-colors"
                />
              </div>
            </div>

            <div>
              <label
                className="block text-xs font-bold uppercase tracking-wide mb-1.5"
                style={{ color: '#112116' }}
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-11 py-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="flex justify-end mt-2">
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold text-slate-500 hover:underline"
                  style={{ color: '#112116' }}
                >
                  Forgot your password?
                </Link>
              </div>
            </div>

            {success && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <p className="text-sm font-medium text-emerald-700">{success}</p>
              </div>
            )}

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm font-medium text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold uppercase tracking-wide text-white disabled:opacity-60 hover:opacity-90 transition-opacity shadow-sm"
              style={{ backgroundColor: '#112116' }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Signing in…
                </>
              ) : (
                'Login'
              )}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-8">
            Don&apos;t have an account?{' '}
            <Link
              href="/bundles?country=TZ&countryName=Tanzania"
              className="font-extrabold hover:underline"
              style={{ color: '#112116' }}
            >
              Get started
            </Link>
          </p>

          <p className="text-center text-xs text-slate-400 mt-5 leading-relaxed">
            By continuing you confirm you have read our{' '}
            <Link href="/terms" className="font-semibold hover:underline" style={{ color: '#112116' }}>
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="font-semibold hover:underline" style={{ color: '#112116' }}>
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
