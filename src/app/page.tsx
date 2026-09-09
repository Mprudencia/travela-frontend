'use client';

import { useAuth } from '@/lib/auth-context';
import { ArrowRight, Loader2, Wifi, Zap, Shield } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BundlesApi } from '@/lib/api';
import {
  type Bundle,
  type BundlesResponse,
  bundleImageFor,
  formatMb,
  mapApiBundles,
} from '@/lib/bundles';

const typingPhrases = [
  'Zanzibar and Africa.',
  'the coast.',
  'your next trip.',
  'Tanzania.',
  'wherever you roam.',
];

function useTypewriter(phrases: string[], typingSpeed = 80, erasingSpeed = 45, pauseMs = 1800) {
  const [displayed, setDisplayed] = useState('');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    const current = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!erasing) {
      if (charIdx < current.length) {
        timeout = setTimeout(() => {
          setDisplayed(current.slice(0, charIdx + 1));
          setCharIdx((c) => c + 1);
        }, typingSpeed);
      } else {
        timeout = setTimeout(() => setErasing(true), pauseMs);
      }
    } else {
      if (charIdx > 0) {
        timeout = setTimeout(() => {
          setDisplayed(current.slice(0, charIdx - 1));
          setCharIdx((c) => c - 1);
        }, erasingSpeed);
      } else {
        setErasing(false);
        setPhraseIdx((i) => (i + 1) % phrases.length);
      }
    }
    return () => clearTimeout(timeout);
  }, [charIdx, erasing, phraseIdx, phrases, typingSpeed, erasingSpeed, pauseMs]);

  return displayed;
}

const howItWorks = [
  {
    icon: <Wifi size={28} />,
    num: '1',
    title: 'Choose Your Plan',
    desc: 'Travela is your eSIM & SIM card solution for seamless connectivity in Tanzania.',
  },
  {
    icon: <Zap size={28} />,
    num: '2',
    title: 'Quick Activation',
    desc: 'Choose your eSIM activation date. We schedule it so you are connected when you need it.',
  },
  {
    icon: <Shield size={28} />,
    num: '3',
    title: 'Roam with confidence',
    desc: '30 days of data, predictable pricing, and support when you need it.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const typedText = useTypewriter(typingPhrases);
  const { isAuthenticated, isLoading } = useAuth();
  const [popularPlans, setPopularPlans] = useState<Bundle[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPlansLoading(true);
      try {
        const res = await BundlesApi.list<BundlesResponse>();
        const apiBundles = res.data?.bundles ?? [];
        const uiBundles = mapApiBundles(apiBundles)
          .slice()
          .sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0))
          .slice(0, 3);
        if (!cancelled) setPopularPlans(uiBundles);
      } catch {
        if (!cancelled) setPopularPlans([]);
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || isAuthenticated) {
    return null;
  }

  const ctaHref = '/bundles?country=TZ&countryName=Tanzania';
  const ctaLabel = 'Get Started';

  return (
    <div>
      {/* Hero — navbar floats over this section */}
      <section className="relative min-h-[92vh] flex flex-col justify-center overflow-hidden">
        {/* Background image */}
        <div className="absolute inset-0">
          <Image
            src="/backgrounds/7.jpg"
            alt="Zanzibar coast"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/20" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-24">
          <div className="max-w-2xl">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-snug mb-4">
              eSIM for Tanzania.
              <span className="block mt-1">Stay connected seamlessly</span>
              <span className="block mt-1">
                in{' '}
                <span style={{ color: '#17cf54' }}>
                  {typedText}
                </span>
                <span
                  className="inline-block w-0.5 h-[1em] align-middle ml-0.5 animate-pulse"
                  style={{ backgroundColor: '#17cf54' }}
                />
              </span>
            </h1>

            <p className="text-lg text-white/80 mb-10 max-w-lg">
              No roaming shock. 30-day plans with activation on the date you choose.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-base font-bold transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#112116', color: 'white' }}
              >
                {ctaLabel} <ArrowRight size={18} />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-base font-bold text-white border border-white/40 hover:bg-white/10 transition-colors"
              >
                Learn More
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Popular Plans */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-8 text-center">
            Popular eSIM Plans for Zanzibar &amp; Tanzania
          </h2>

          {plansLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={28} className="animate-spin text-slate-400" />
            </div>
          ) : popularPlans.length === 0 ? (
            <p className="text-center text-slate-500">No plans available right now. Please check back soon.</p>
          ) : (
            <div className="grid sm:grid-cols-3 gap-6">
              {popularPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* Photo */}
                  <div className="relative h-44">
                    <Image
                      src={bundleImageFor(plan.id)}
                      alt=""
                      fill
                      className="object-cover"
                    />
                  </div>

                  {/* Info */}
                  <div className="p-5">
                    <p className="text-lg font-black text-slate-900 mb-0.5">{plan.name}</p>
                    <h3 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">
                      {formatMb(plan.data_mb)}
                    </h3>
                    {plan.tagline && (
                      <p className="text-xs font-semibold text-slate-600 mb-1">{plan.tagline}</p>
                    )}
                    <p className="text-sm text-slate-500 mb-3">
                      {plan.validity_days ?? 30} days, {plan.currency ?? 'USD'}{' '}
                      {Number(plan.price ?? 0).toFixed(2)}
                    </p>
                    <Link
                      href={`/bundles?country=TZ&countryName=Tanzania&bundleId=${plan.id}`}
                      className="block w-full text-center py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: '#112116' }}
                    >
                      Buy Now
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-16" style={{ backgroundColor: '#f6f8f6' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-12 text-center">
            How It Works
          </h2>

          <div className="grid sm:grid-cols-3 gap-10">
            {howItWorks.map((step) => (
              <div key={step.num} className="text-center">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ backgroundColor: 'rgba(17,33,22,0.08)', color: '#112116' }}
                >
                  {step.icon}
                </div>
                <h3 className="text-base font-extrabold text-slate-900 mb-2">
                  {step.num}. {step.title}
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — photo card so it doesn’t blend into the dark footer */}
      <section className="relative py-10 sm:py-14" style={{ backgroundColor: '#f6f8f6' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-[2rem] px-6 py-16 sm:px-12 sm:py-20 text-white shadow-lg">
            <Image
              src="/backgrounds/6.jpg"
              alt=""
              fill
              className="object-cover object-center"
              sizes="100vw"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(120deg, rgba(17,33,22,0.88) 0%, rgba(17,33,22,0.72) 48%, rgba(23,207,84,0.28) 100%)',
              }}
            />
            <div
              className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full blur-3xl opacity-40"
              style={{ backgroundColor: '#17cf54' }}
            />
            <div
              className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full blur-3xl opacity-25"
              style={{ backgroundColor: '#17cf54' }}
            />

            <div className="relative max-w-2xl mx-auto text-center">
              <p
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase mb-5"
                style={{ backgroundColor: 'rgba(23,207,84,0.18)', color: '#17cf54' }}
              >
                Tanzania eSIM &amp; SIM
              </p>
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
                Ready to travel{' '}
                <span style={{ color: '#17cf54' }}>connected</span>?
              </h2>
              <p className="text-base text-white/80 mb-8">
                Join thousands of travellers staying connected across Africa with Travela eSIMs and SIM cards.
              </p>
              <Link
                href="/bundles?country=TZ&countryName=Tanzania"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-base font-bold transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#17cf54', color: '#112116' }}
              >
                Get your SIM now <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
