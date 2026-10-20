'use client';

import { ArrowRight, Check, Loader2, Package, Smartphone } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BundlesApi, EsimsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getOptimisticDataMb } from '@/lib/balance-poll';
import {
  type Bundle,
  type BundlesResponse,
  bundleImageFor,
  formatMb,
  mapApiBundles,
} from '@/lib/bundles';
import { dataMbFromAssignment } from '@/lib/esim-balance';

type CheckoutMode = 'standard' | 'topup';

/** Physical SIM pickup is paused until the booth is available. */
const SIM_TYPE = 'esim' as const;

/** Prefer a column count that fills rows evenly (e.g. 4 → 2×2, not 3+1). */
function bundleColumnCount(n: number): 1 | 2 | 3 {
  if (n <= 1) return 1;
  if (n === 2 || n === 4) return 2;
  if (n % 3 === 0) return 3;
  if (n % 3 === 1) return 2; // avoid a single leftover in a 3-col row
  return 3; // last row has 2 — centered via flex
}

function bundleCardWidthClass(cols: 1 | 2 | 3): string {
  if (cols === 1) return 'w-full max-w-sm';
  if (cols === 2) return 'w-full sm:w-[calc(50%-0.5rem)] max-w-md';
  return 'w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.667rem)] max-w-md';
}

function scrollToEl(el: HTMLElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function BundlesContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const country = params.get('country') ?? 'TZ';
  const countryName = params.get('countryName') ?? 'Tanzania';
  const topupParam = params.get('topup');

  const bundleIdParam = params.get('bundleId');

  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBundleId, setSelectedBundleId] = useState<string | number | null>(null);
  const [browseAllPlans, setBrowseAllPlans] = useState(false);

  const step2Ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const root = document.documentElement;
    const previousBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    root.style.scrollBehavior = previousBehavior;
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await BundlesApi.list<BundlesResponse>();
        if (!cancelled) setBundles(mapApiBundles(res.data?.bundles ?? []));
      } catch {
        if (!cancelled) setBundles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [country, authLoading]);

  // Coming from a specific "Buy Now" click (e.g. landing page plan card) — skip re-choosing the bundle.
  useEffect(() => {
    if (!bundleIdParam || bundles.length === 0) return;
    const match = bundles.find((b) => String(b.id) === String(bundleIdParam));
    if (match) setSelectedBundleId(match.id);
  }, [bundleIdParam, bundles]);

  // After plan is chosen → scroll to Continue
  useEffect(() => {
    if (!selectedBundleId) return;
    const t = setTimeout(() => scrollToEl(step2Ref.current), 100);
    return () => clearTimeout(t);
  }, [selectedBundleId]);

  const selectedBundle = bundles.find((b) => String(b.id) === String(selectedBundleId)) ?? null;
  const preselectedBundle =
    bundleIdParam && !browseAllPlans
      ? bundles.find((b) => String(b.id) === String(bundleIdParam)) ?? null
      : null;
  const bundleCols = bundleColumnCount(bundles.length);
  const bundleCardWidth = bundleCardWidthClass(bundleCols);

  const currentStep = !selectedBundle ? 1 : 2;

  const selectBundle = (id: string | number) => {
    setSelectedBundleId(id);
  };

  const handleCheckout = async () => {
    if (!selectedBundle) return;
    const isRegisteredCustomer = !!localStorage.getItem('token');
    const checkoutMode: CheckoutMode =
      topupParam === '1' || isRegisteredCustomer ? 'topup' : 'standard';

    let user_esim_id: number | undefined;
    let msisdn: string | undefined;
    let current_data_mb: number | undefined;

    if (checkoutMode === 'topup') {
      try {
        const res = await EsimsApi.listMine();
        if (!res.ok) {
          window.alert('Could not load your SIM. Try again from the dashboard.');
          return;
        }
        const body = res.body as { data?: unknown[]; esims?: unknown[] } | unknown[];
        const rows = Array.isArray(body)
          ? body
          : Array.isArray(body?.data)
            ? body.data
            : Array.isArray(body?.esims)
              ? body.esims
              : [];
        const first = rows[0] as {
          id?: number;
          balances?: Record<string, unknown> | null;
          bundle?: { data_mb?: number | null };
          order_item?: { data_amount?: number | null };
          esim?: { msisdn?: string | null; phone_number?: string | null };
        } | undefined;
        user_esim_id = first?.id;
        msisdn =
          first?.esim?.msisdn?.trim() ||
          first?.esim?.phone_number?.trim() ||
          undefined;
        if (!user_esim_id || !msisdn) {
          window.alert('No SIM found on your account. Complete your first purchase first.');
          return;
        }
        current_data_mb =
          getOptimisticDataMb() ?? dataMbFromAssignment(first) ?? 0;
      } catch {
        window.alert('Could not load your SIM. Try again from the dashboard.');
        return;
      }
    }

    // Generate a one-time nonce so checkout can detect cart tampering.
    const cartNonce =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('travela:cartNonce', cartNonce);

    localStorage.setItem(
      'cart',
      JSON.stringify({
        bundle: selectedBundle,
        country,
        countryName,
        simType: SIM_TYPE,
        checkoutMode,
        // Security metadata — validated in checkout
        _cartCreatedAt: new Date().toISOString(),
        _cartNonce: cartNonce,
        ...(checkoutMode === 'topup'
          ? { user_esim_id, msisdn, current_data_mb }
          : {}),
      })
    );
    router.push('/checkout');
  };

  const steps = [
    { n: 1, label: 'Data plan' },
    { n: 2, label: 'Continue' },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f6f8f6' }}>
      {/* Header */}
      <div
        className="relative py-14 px-4 overflow-hidden"
        style={{ backgroundColor: '#112116' }}
      >
        <div className="absolute inset-0 opacity-20">
          <Image
            src="/backgrounds/1.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
          />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#17cf54' }}>
            Tanzania mainland and Zanzibar
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white mb-2">
            {preselectedBundle ? 'Confirm Your eSIM Plan' : 'Choose Your eSIM Plan'}
          </h1>
          <p className="text-white/60 text-base max-w-2xl mx-auto leading-relaxed mb-6">
            Two quick steps. Confirm your phone supports eSIM, pick a plan, then continue.
          </p>

          {/* Step progress */}
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {steps.map((s, i) => {
              const done = currentStep > s.n;
              const active = currentStep === s.n;
              return (
                <div key={s.n} className="flex items-center gap-2 sm:gap-3">
                  {i > 0 && (
                    <div
                      className="w-6 sm:w-10 h-0.5 rounded-full"
                      style={{
                        backgroundColor: done || active ? '#17cf54' : 'rgba(255,255,255,0.2)',
                      }}
                    />
                  )}
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold"
                      style={
                        done || active
                          ? { backgroundColor: '#17cf54', color: '#112116' }
                          : {
                              backgroundColor: 'rgba(255,255,255,0.15)',
                              color: 'rgba(255,255,255,0.5)',
                            }
                      }
                    >
                      {done ? <Check size={14} strokeWidth={3} /> : s.n}
                    </span>
                    <span
                      className={`text-xs font-bold hidden sm:inline ${
                        active || done ? 'text-white' : 'text-white/40'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* eSIM compatibility reminder */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-8">
          <div className="flex gap-3">
            <div
              className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center"
              style={{ backgroundColor: 'rgba(17,33,22,0.08)', color: '#112116' }}
            >
              <Smartphone size={20} />
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-900 mb-1">
                Check that your phone supports eSIM
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Dial <span className="font-bold text-slate-700">*#06#</span> on your phone. If you
                see an <span className="font-bold text-slate-700">EID</span> number with a barcode,
                you&apos;re good to go. We currently offer eSIM only — physical SIM cards will be
                available once our booth opens.
              </p>
            </div>
          </div>
        </div>

        {/* Step 1 — Bundles */}
        <div id="step-plan" className="scroll-mt-24">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="text-[11px] font-extrabold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(17,33,22,0.08)', color: '#112116' }}
            >
              Step 1
            </span>
            <p className="text-sm font-bold text-slate-700">Choose your data plan</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={28} className="animate-spin text-slate-400" />
            </div>
          ) : preselectedBundle ? (
            <div className="max-w-sm mx-auto mb-8">
              <div
                className="rounded-2xl overflow-hidden border-2 bg-white shadow-md"
                style={{ borderColor: '#112116' }}
              >
                <div className="relative h-40">
                  <Image
                    src={bundleImageFor(preselectedBundle.id)}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 24rem"
                    className="object-cover"
                  />
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-lg font-black text-slate-900">{preselectedBundle.name}</p>
                    <span
                      className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: '#17cf54', color: '#112116' }}
                    >
                      <Check size={12} /> Selected
                    </span>
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">
                    {formatMb(preselectedBundle.data_mb)}
                  </h3>
                  {preselectedBundle.tagline && (
                    <p className="text-xs font-semibold text-slate-600 mb-1">
                      {preselectedBundle.tagline}
                    </p>
                  )}
                  <p className="text-sm text-slate-500">
                    {preselectedBundle.validity_days ?? 30} days,{' '}
                    {preselectedBundle.currency ?? 'USD'}{' '}
                    {Number(preselectedBundle.price ?? 0).toFixed(2)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBrowseAllPlans(true)}
                className="block w-full text-center mt-3 text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                Choose a different plan
              </button>
            </div>
          ) : bundles.length === 0 ? (
            <div className="text-center py-20">
              <Package size={40} className="mx-auto mb-4 text-slate-300" />
              <p className="text-slate-500 font-medium">
                No bundles available for this destination.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              {bundles.map((bundle) => {
                const isSelected = String(selectedBundleId) === String(bundle.id);
                const imgSrc = bundleImageFor(bundle.id);
                return (
                  <button
                    key={bundle.id}
                    type="button"
                    onClick={() => selectBundle(bundle.id)}
                    className={`${bundleCardWidth} text-left rounded-2xl overflow-hidden border bg-white shadow-sm hover:shadow-md transition-all ${
                      isSelected
                        ? 'border-[#112116] shadow-md ring-2 ring-[#112116]'
                        : 'border-slate-100'
                    }`}
                  >
                    <div className="relative h-44">
                      <Image
                        src={imgSrc}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 100vw, 33vw"
                        className="object-cover"
                      />
                    </div>

                    <div className="p-5">
                      <p className="text-lg font-black text-slate-900 mb-0.5">{bundle.name}</p>
                      <h3 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">
                        {formatMb(bundle.data_mb)}
                      </h3>
                      {bundle.tagline && (
                        <p className="text-xs font-semibold text-slate-600 mb-1">
                          {bundle.tagline}
                        </p>
                      )}
                      <p className="text-sm text-slate-500 mb-4">
                        {bundle.validity_days ?? 30} days, {bundle.currency ?? 'USD'}{' '}
                        {Number(bundle.price ?? 0).toFixed(2)}
                      </p>

                      <div
                        className="w-full py-3 rounded-xl text-sm font-bold text-center transition-opacity flex items-center justify-center gap-2"
                        style={
                          isSelected
                            ? { backgroundColor: '#17cf54', color: '#112116' }
                            : { backgroundColor: '#112116', color: 'white' }
                        }
                      >
                        {isSelected ? (
                          <>
                            <Check size={16} /> Selected
                          </>
                        ) : (
                          'Select Plan'
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Step 2 — Continue */}
        {selectedBundle && (
          <div ref={step2Ref} id="step-continue" className="scroll-mt-28 mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[11px] font-extrabold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(23,207,84,0.2)', color: '#112116' }}
              >
                Step 2
              </span>
              <p className="text-sm font-bold text-slate-700">Ready to continue</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p className="text-sm text-slate-600 mb-4">
                You picked{' '}
                <span className="font-extrabold text-slate-900">eSIM</span>
                {' '}
                and{' '}
                <span className="font-extrabold text-slate-900">{selectedBundle.name}</span>
                {' '}
                (
                {selectedBundle.currency ?? 'USD'} {Number(selectedBundle.price ?? 0).toFixed(2)}
                ). Tap Continue below to checkout.
              </p>
              <button
                type="button"
                onClick={handleCheckout}
                className="w-full flex items-center justify-center gap-2 px-5 py-4 rounded-xl text-sm font-bold text-white hover:opacity-95"
                style={{ backgroundColor: '#112116' }}
              >
                Continue
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}

export default function BundlesPage() {
  return (
    <Suspense>
      <BundlesContent />
    </Suspense>
  );
}
