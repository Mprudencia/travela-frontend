'use client';

import { useAuth } from '@/lib/auth-context';
import { Mail } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function Footer() {
  const { isAuthenticated, isLoading } = useAuth();

  const accountLinks = [
    ...(!isLoading && !isAuthenticated
      ? [{ href: '/auth/login', label: 'Sign In' }]
      : []),
    { href: '/profile', label: 'Profile' },
  ];

  return (
    <footer style={{ backgroundColor: '#112116' }} className="text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            {/* Travela logo */}
            <div className="mb-3">
              <Image
                src="/logos/travela_white.png"
                alt="Travela"
                width={130}
                height={40}
                className="h-9 w-auto object-contain"
              />
            </div>

            <p className="text-sm text-white/60 leading-relaxed max-w-xs mb-5">
              Stay connected across Africa with instant eSIM and physical SIM cards.
              No roaming fees, just seamless travel connectivity.
            </p>

            {/* Powered by Onnela */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/30">Powered by</span>
              <Image
                src="/logos/onnela_logo.png"
                alt="Onnela"
                width={72}
                height={24}
                className="h-5 w-auto object-contain opacity-60 hover:opacity-90 transition-opacity"
              />
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">
              Product
            </h3>
            <ul className="space-y-2">
              {[
                { href: '/bundles?country=TZ&countryName=Tanzania', label: 'Get eSIM / SIM' },
                { href: '/dashboard', label: 'Dashboard' },
                { href: '/receipts', label: 'Transaction History' },
              ].map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="text-sm text-white/60 hover:text-white transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Account */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">
              Account
            </h3>
            <ul className="space-y-2">
              {accountLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-white/60 hover:text-white transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>

            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mt-6 mb-4">
              Legal
            </h3>
            <ul className="space-y-2">
              {[
                { href: '/terms', label: 'Terms and Conditions' },
                { href: '/privacy', label: 'Privacy Policy' },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-white/60 hover:text-white transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3 mt-6">
              <a
                href="https://www.instagram.com/thetravela_esim?igsh=a2k5ajE2bTAyenMw"
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                aria-label="Instagram"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a
                href="mailto:hello@thetravela.com"
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                aria-label="Email"
              >
                <Mail size={15} />
              </a>
            </div>
          </div>
        </div>

        <hr className="border-white/10 mt-10 mb-6" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/30">
          <p>© {new Date().getFullYear()} Travela by Onnela. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-white/60 transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-white/60 transition-colors">
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
