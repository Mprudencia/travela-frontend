'use client';

import EmailVerificationBanner from '@/components/auth/EmailVerificationBanner';
import {
  apiErrorMessage,
  AuthApi,
  extractAuthTokenFromBody,
  extractUserFromAuthBody,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  ArrowRight,
  Bell,
  CheckCircle,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Globe,
  HelpCircle,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Receipt,
  Shield,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORT_EMAIL = 'hello@onnelalimited.com';

const menuItems = [
  { icon: <Receipt size={18} />, label: 'Transaction History', href: '/receipts' },
  { icon: <Globe size={18} />, label: 'My eSIMs', href: '/dashboard' },
  { icon: <Bell size={18} />, label: 'Notifications', href: '#' },
  { icon: <Shield size={18} />, label: 'Security', href: '#' },
  { icon: <FileText size={18} />, label: 'Terms and Conditions', href: '/terms' },
  { icon: <Lock size={18} />, label: 'Privacy Policy', href: '/privacy' },
  { icon: <HelpCircle size={18} />, label: 'Help & Support', href: '#' },
];

export default function ProfilePage() {
  const { isAuthenticated, user, logout, adoptSession, login } = useAuth();
  const router = useRouter();

  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailInfo, setEmailInfo] = useState('');

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailInfo('');

    const trimmed = newEmail.trim().toLowerCase();
    const name = (typeof user?.name === 'string' && user.name.trim()) || 'Traveller';

    if (!trimmed) {
      setEmailError('Enter a new email address.');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    if (trimmed === (user?.email ?? '').trim().toLowerCase()) {
      setEmailError('That is already your current email.');
      return;
    }
    if (password.length < 8) {
      setEmailError('Enter your current password (at least 8 characters).');
      return;
    }

    setChangingEmail(true);
    try {
      // Temporary approach until a true change-email API exists:
      // register a new account with the same name + password, new email only.
      const result = await AuthApi.register({
        name,
        email: trimmed,
        password,
      });

      if (!result.ok) {
        setEmailError(
          apiErrorMessage(
            result.body,
            `Could not create the new email account (HTTP ${result.status}).`
          )
        );
        return;
      }

      const token = extractAuthTokenFromBody(result.body);
      const apiUser = extractUserFromAuthBody(result.body);

      if (token) {
        adoptSession(token, {
          id: apiUser?.id,
          name: apiUser?.name ?? name,
          email: apiUser?.email ?? trimmed,
          email_verified: false,
          role: apiUser?.role ?? 'user',
        });
      } else {
        // Register succeeded but no token — sign in with the new credentials.
        await login(trimmed, password);
      }

      setNewEmail('');
      setPassword('');
      setEmailInfo(
        'New account created with this email. Check your inbox for a verification code.'
      );
      router.push(
        `/auth/verify-email?redirect=${encodeURIComponent('/profile')}`
      );
    } catch (err: unknown) {
      setEmailError(
        err instanceof Error
          ? err.message
          : `Could not switch to the new email. Contact ${SUPPORT_EMAIL} if you need help.`
      );
    } finally {
      setChangingEmail(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-sm w-full">
          <div
            className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-4"
            style={{ backgroundColor: '#112116' }}
          >
            <User size={24} color="white" />
          </div>
          <h2 className="text-lg font-extrabold text-slate-900 mb-2">Your Profile</h2>
          <p className="text-sm text-slate-500 mb-5">
            Sign in to access your profile and account settings.
          </p>
          <Link
            href="/auth/login"
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold text-white hover:opacity-90"
            style={{ backgroundColor: '#112116' }}
          >
            Sign In <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  const verified = user?.email_verified === true;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f6f8f6' }}>
      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Avatar & name */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 mb-5 flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#112116' }}
          >
            <User size={26} color="white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-slate-900">
              {user?.name ?? 'Traveller'}
            </h2>
            <p className="text-sm text-slate-500 truncate">{user?.email}</p>
            <p
              className={`mt-1 inline-flex items-center gap-1 text-xs font-bold ${
                verified ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {verified ? (
                <>
                  <CheckCircle size={12} /> Email verified
                </>
              ) : (
                <>
                  <Mail size={12} /> Email not verified
                </>
              )}
            </p>
          </div>
        </div>

        {!verified && (
          <EmailVerificationBanner variant="card" className="mb-5" />
        )}

        {/* Account email management */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Mail size={16} style={{ color: '#112116' }} />
            <h3 className="text-sm font-extrabold text-slate-900">Account email</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            For now, this creates a <span className="font-semibold">new account</span> with
            your same name and password, using the new email. Then you verify that
            email.
          </p>

          <form onSubmit={(e) => void handleChangeEmail(e)} className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                New email
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={user?.email ?? 'you@example.com'}
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                Current password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Same password as this account"
                  autoComplete="current-password"
                  className="w-full px-4 py-3 pr-11 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {emailInfo && (
              <p className="text-xs font-medium text-emerald-700">{emailInfo}</p>
            )}
            {emailError && (
              <p className="text-xs font-medium text-red-600">{emailError}</p>
            )}
            <button
              type="submit"
              disabled={changingEmail || !newEmail.trim() || !password}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60 hover:opacity-90"
              style={{ backgroundColor: '#112116' }}
            >
              {changingEmail ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Creating…
                </>
              ) : (
                <>
                  Continue with new email <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
            Having trouble?{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                'Travela change email help'
              )}&body=${encodeURIComponent(
                `Hi,\n\nPlease help me change the email on my Travela account.\nCurrent email: ${user?.email ?? ''}\nRequested email: ${newEmail || '(not filled)'}\n`
              )}`}
              className="underline hover:text-slate-600"
            >
              Email {SUPPORT_EMAIL}
            </a>
          </p>
        </div>

        {/* Menu */}
        <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50 mb-5">
          {menuItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3 text-slate-700">
                <span style={{ color: '#112116' }}>{item.icon}</span>
                <span className="text-sm font-semibold">{item.label}</span>
              </div>
              <ChevronRight size={16} className="text-slate-300" />
            </Link>
          ))}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-colors"
        >
          <LogOut size={16} /> Sign Out
        </button>

        <p className="text-center text-xs text-slate-300 mt-6">
          Travela · by Onnela · For A More Enjoyable Life
        </p>
      </div>
    </div>
  );
}
