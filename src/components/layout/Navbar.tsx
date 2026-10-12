'use client';

import { useAuth } from '@/lib/auth-context';
import {
  Bell,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  User,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const publicLinks = [
  { href: '/', label: 'Home' },
  { href: '/bundles?country=TZ&countryName=Tanzania', label: 'eSIM Plans' },
  { href: '/#how-it-works', label: 'How It Works' },
  { href: '/#how-it-works', label: 'Help' },
];

const authLinks = [
  { href: '/bundles?country=TZ&countryName=Tanzania', label: 'eSIM Plans' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/receipts', label: 'Transaction History' },
];

export default function Navbar() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // On the home page the navbar floats over the hero image
  const isHome = pathname === '/';

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  // Immersive auth screens use a full-page split layout
  if (pathname === '/auth/login') return null;

  const handleLogout = () => {
    logout();
    router.push('/');
    setUserMenuOpen(false);
    setMenuOpen(false);
  };

  // Keep initial server/client markup stable to avoid hydration mismatch.
  const navLinks = !isLoading && isAuthenticated ? authLinks : publicLinks;

  return (
    <header
      className={`${
        isHome
          ? 'absolute top-0 left-0 right-0 z-50'
          : 'sticky top-0 z-50 bg-white border-b border-slate-100 shadow-sm'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo — white on hero, dark elsewhere */}
          <Link href="/" className="flex items-center flex-shrink-0" onClick={() => setMenuOpen(false)}>
            <Image
              src={isHome ? '/logos/travela_white.png' : '/logos/travela_dark.png'}
              alt="Travela"
              width={isHome ? 160 : 110}
              height={isHome ? 52 : 36}
              className={`w-auto object-contain ${isHome ? 'h-11 sm:h-12' : 'h-8'}`}
              priority
            />
          </Link>

          {/* Desktop nav — pill container */}
          <nav
            className="hidden md:flex items-center gap-1 px-2 py-1 rounded-full"
            style={
              isHome
                ? {
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.2)',
                  }
                : {}
            }
          >
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                    isHome
                      ? isActive
                        ? 'bg-white/20 text-white'
                        : 'text-white/90 hover:text-white hover:bg-white/15'
                      : isActive
                        ? 'text-slate-900 underline underline-offset-4'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {!isLoading && (
              <>
                {isAuthenticated ? (
                  <>
                    <button
                      className={`hidden sm:flex w-9 h-9 rounded-full items-center justify-center transition-colors ${
                        isHome
                          ? 'bg-white/15 text-white hover:bg-white/25'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                      aria-label="Notifications"
                    >
                      <Bell size={18} />
                    </button>

                    <div className="relative">
                      <button
                        onClick={() => setUserMenuOpen(!userMenuOpen)}
                        className={`flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border transition-colors ${
                          isHome
                            ? 'border-white/30 hover:border-white/50 bg-white/10'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: '#112116' }}
                        >
                          <User size={14} color="white" />
                        </div>
                        <span
                          className={`hidden sm:block text-sm font-semibold ${
                            isHome ? 'text-white' : 'text-slate-700'
                          }`}
                        >
                          {user?.name?.split(' ')[0] ?? 'Account'}
                        </span>
                      </button>

                      {userMenuOpen && (
                        <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-lg border border-slate-100 py-1 z-50">
                          <div className="px-4 py-2.5 border-b border-slate-100">
                            <p className="text-xs font-bold text-slate-900">{user?.name ?? 'Traveller'}</p>
                            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                          </div>
                          {[
                            { href: '/dashboard', icon: <LayoutDashboard size={15} />, label: 'Dashboard' },
                            { href: '/profile', icon: <User size={15} />, label: 'Profile' },
                            { href: '/receipts', icon: <Receipt size={15} />, label: 'Transaction History' },
                          ].map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                              onClick={() => setUserMenuOpen(false)}
                            >
                              {item.icon} {item.label}
                            </Link>
                          ))}
                          <hr className="my-1 border-slate-100" />
                          <button
                            onClick={handleLogout}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                          >
                            <LogOut size={15} /> Sign out
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <Link
                    href="/auth/login"
                    className={`hidden sm:inline-flex px-4 py-2 text-sm font-semibold transition-colors ${
                      isHome
                        ? 'text-white/80 hover:text-white'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    Sign in
                  </Link>
                )}
              </>
            )}

            {/* Mobile toggle */}
            <button
              type="button"
              className={`md:hidden w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
                isHome
                  ? 'text-white bg-white/15 border border-white/25 hover:bg-white/25'
                  : 'text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100'
              }`}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile full-screen drawer */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="absolute inset-y-0 right-0 w-full max-w-sm flex flex-col shadow-2xl"
            style={{ backgroundColor: isHome ? '#112116' : '#ffffff' }}
          >
            <div
              className={`flex items-center justify-between h-16 px-4 border-b ${
                isHome ? 'border-white/10' : 'border-slate-100'
              }`}
            >
              <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center">
                <Image
                  src={isHome ? '/logos/travela_white.png' : '/logos/travela_dark.png'}
                  alt="Travela"
                  width={130}
                  height={40}
                  className="h-9 w-auto object-contain"
                />
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className={`w-10 h-10 flex items-center justify-center rounded-xl ${
                  isHome
                    ? 'text-white bg-white/10 border border-white/20'
                    : 'text-slate-700 bg-slate-50 border border-slate-200'
                }`}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className={`block px-4 py-3.5 rounded-xl text-base font-semibold transition-colors ${
                    isHome
                      ? 'text-white hover:bg-white/10'
                      : 'text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div
              className={`px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t ${
                isHome ? 'border-white/10' : 'border-slate-100'
              }`}
            >
              {!isLoading && !isAuthenticated && (
                <Link
                  href="/auth/login"
                  onClick={() => setMenuOpen(false)}
                  className={`flex w-full items-center justify-center px-4 py-3.5 rounded-xl text-sm font-bold ${
                    isHome
                      ? 'text-[#112116] bg-white hover:bg-white/90'
                      : 'text-white'
                  }`}
                  style={!isHome ? { backgroundColor: '#112116' } : undefined}
                >
                  Sign in
                </Link>
              )}
              {!isLoading && isAuthenticated && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`flex w-full items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-bold ${
                    isHome
                      ? 'text-red-300 bg-white/10 hover:bg-white/15'
                      : 'text-red-600 bg-red-50 hover:bg-red-100'
                  }`}
                >
                  <LogOut size={16} /> Sign out
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
