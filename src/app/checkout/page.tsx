'use client';

import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import LegalAcceptance from '@/components/legal/LegalAcceptance';
import { AuthApi, extractAuthTokenFromBody, OrderApi } from '@/lib/api';
import { AUTH_STORAGE_SYNC } from '@/lib/auth-context';
import {
  extractPaymentUrl,
  normalizePaymentUrl,
  resolvePaymentTargetUrl,
} from '@/lib/payment';
import { startBalancePoll } from '@/lib/balance-poll';

interface CartBundle {
  id: string | number;
  sim_bundle_id?: number | null;
  name: string;
  data_mb?: number;
  validity_days?: number;
  price?: string | number;
  currency?: string;
  description?: string;
}

/** Only one eSIM/SIM can be purchased per order — no multi-item cart. */
interface Cart {
  bundle: CartBundle;
  country: string;
  countryName: string;
  simType: 'esim' | 'physical';
  /** YYYY-MM-DD — eSIM activation date (API still stores this as trip arrival_date) */
  tripArrivalDate?: string;
  /** YYYY-MM-DD — plan expiry, derived from activation date + validity */
  tripDepartureDate?: string;
  checkoutMode?: 'standard' | 'topup';
  /** Required for top-up: user's assigned SIM */
  user_esim_id?: number;
  msisdn?: string;
  /** Known data balance (MB) at top-up time — used for optimistic total */
  current_data_mb?: number;
}

function formatMb(mb?: number) {
  if (!mb) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

/** Placeholder KYC when user does not fill a form — must match API validation rules. */
const KYC_PLACEHOLDER = {
  passport_id: 'N/A',
  nationality: 'Other',
  gender: 'Other' as const,
  reason_for_travel: 'Tourism' as const,
};

const NATIONALITIES = [
  'Tanzanian',
  'Kenyan',
  'Ugandan',
  'Rwandan',
  'Burundian',
  'Congolese',
  'South African',
  'Nigerian',
  'Ghanaian',
  'Ethiopian',
  'Egyptian',
  'Moroccan',
  'American',
  'British',
  'Canadian',
  'Australian',
  'German',
  'French',
  'Italian',
  'Spanish',
  'Dutch',
  'Belgian',
  'Swiss',
  'Swedish',
  'Norwegian',
  'Danish',
  'Finnish',
  'Irish',
  'Portuguese',
  'Polish',
  'Russian',
  'Turkish',
  'Indian',
  'Chinese',
  'Japanese',
  'Korean',
  'Emirati',
  'Saudi',
  'Israeli',
  'Brazilian',
  'Mexican',
  'Argentine',
  'Other',
] as const;

type Step = 'register' | 'otp' | 'payment' | 'success';

const STEPS: { id: Step; label: string }[] = [
  { id: 'register', label: 'Create Account' },
  { id: 'otp', label: 'Verify Email' },
  { id: 'payment', label: 'Payment' },
];

function apiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as { message?: unknown; errors?: Record<string, unknown> };
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }
  const errors = record.errors;
  if (errors && typeof errors === 'object') {
    for (const value of Object.values(errors)) {
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
      if (typeof value === 'string') return value;
    }
  }
  return fallback;
}

const TOPUP_STEPS: { id: Step; label: string }[] = [
  { id: 'payment', label: 'Payment' },
];

const CHECKOUT_TRANSITION_KEY = 'travela:checkout-transition';

function checkoutPageTransitionClass(revealed: boolean) {
  return `transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
    revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
  }`;
}

function tripInclusiveDays(arrivalIso: string, departureIso: string) {
  const a = new Date(arrivalIso + 'T12:00:00');
  const b = new Date(departureIso + 'T12:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToIso(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Default eSIM activation date (today) and expiry (activation + 30 days) for the order API. */
function defaultActivationDates() {
  const activation = todayIso();
  return {
    tripArrivalDate: activation,
    tripDepartureDate: addDaysToIso(activation, 30),
  };
}

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [step, setStep] = useState<Step>('register');
  const [isTopUpFlow, setIsTopUpFlow] = useState(false);

  // Registration
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [nationality, setNationality] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [legalError, setLegalError] = useState('');
  const [activationDateError, setActivationDateError] = useState('');

  // OTP
  const [otp, setOtp] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpInfo, setOtpInfo] = useState('');
  const [resendingOtp, setResendingOtp] = useState(false);
  const [resendCooldownEndsAt, setResendCooldownEndsAt] = useState<number>(0);
  const [resendSecondsLeft, setResendSecondsLeft] = useState<number>(0);

  // Payment
  const [paying, setPaying] = useState(false);
  const [showPaymentRedirectDialog, setShowPaymentRedirectDialog] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState<number | null>(null);
  const [orderDraftId, setOrderDraftId] = useState<string>(() => `DRAFT-${new Date().getFullYear()}-${Date.now()}`);
  const [orderStoredSummary, setOrderStoredSummary] = useState<{
    order_id?: string | number;
    draft_id?: string;
    payment_url?: string;
    status?: string;
    total_amount?: number | string;
    currency?: string;
  } | null>(null);
  const [checkoutRevealed, setCheckoutRevealed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return sessionStorage.getItem(CHECKOUT_TRANSITION_KEY) !== 'topup-modal';
  });

  const getStoredUserId = (): number | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return null;
      const u = JSON.parse(raw) as { id?: number | string };
      if (typeof u.id === 'number') return u.id;
      if (typeof u.id === 'string' && /^\d+$/.test(u.id)) return Number(u.id);
    } catch {
      // ignore
    }
    return null;
  };

  const isStoredEmailVerified = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return false;
      const u = JSON.parse(raw) as { email_verified?: boolean };
      return u.email_verified === true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (checkoutRevealed) return;
    sessionStorage.removeItem(CHECKOUT_TRANSITION_KEY);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setCheckoutRevealed(true));
    });
    return () => cancelAnimationFrame(id);
  }, [checkoutRevealed]);

  useEffect(() => {
    const raw = localStorage.getItem('cart');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Cart;
        const topUpCheckout = parsed.checkoutMode === 'topup';
        setIsTopUpFlow(topUpCheckout);

        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          try {
            const user = JSON.parse(storedUser) as { name?: string; email?: string };
            setFullName(user.name ?? '');
            setEmail(user.email ?? '');
          } catch {
            // ignore malformed stored user data
          }
        }

        const defaults = defaultActivationDates();
        const withActivationDates: Cart = {
          ...parsed,
          tripArrivalDate: parsed.tripArrivalDate ?? defaults.tripArrivalDate,
          tripDepartureDate: parsed.tripDepartureDate ?? defaults.tripDepartureDate,
        };
        setCart(withActivationDates);
        localStorage.setItem('cart', JSON.stringify(withActivationDates));

        if (topUpCheckout) {
          setStep('payment');
        } else {
          const token = localStorage.getItem('token');
          if (token) {
            const storedId = getStoredUserId();
            if (storedId) setRegisteredUserId(storedId);
            setStep(isStoredEmailVerified() ? 'payment' : 'otp');
          } else {
            setStep('register');
          }
        }
      }
      catch { router.push('/bundles?country=TZ&countryName=Tanzania'); }
    } else {
      router.push('/bundles?country=TZ&countryName=Tanzania');
    }
  }, [router]);

  useEffect(() => {
    if (step === 'success' && isTopUpFlow) {
      router.replace('/dashboard');
    }
  }, [step, isTopUpFlow, router]);

  useEffect(() => {
    if (step !== 'otp') return;
    const tick = () => {
      const msLeft = Math.max(0, resendCooldownEndsAt - Date.now());
      setResendSecondsLeft(Math.ceil(msLeft / 1000));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [step, resendCooldownEndsAt]);

  if (!cart) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${checkoutPageTransitionClass(checkoutRevealed)}`}
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <Loader2 size={28} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const total = Number(cart.bundle.price ?? 0);
  const currency = cart.bundle.currency ?? 'USD';
  const validityDays = cart.bundle.validity_days ?? 30;
  const expiryDate =
    cart.tripDepartureDate ?? addDaysToIso(cart.tripArrivalDate ?? todayIso(), validityDays);

  const formatDisplayDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const handleActivationDateChange = (newDateIso: string) => {
    if (!newDateIso) return;
    setActivationDateError('');
    setCart((prev) => {
      if (!prev) return prev;
      const updated: Cart = {
        ...prev,
        tripArrivalDate: newDateIso,
        tripDepartureDate: addDaysToIso(newDateIso, 30),
      };
      localStorage.setItem('cart', JSON.stringify(updated));
      return updated;
    });
  };

  /** Open a blank tab synchronously on user click (call before any await). */
  const beginPaymentTab = (): Window | null => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    return tab;
  };

  /** Navigate payment tab to URL. Avoid noopener/noreferrer feature flags — they make window.open return null even when the tab opens. */
  const openPaymentInNewTab = (url: string, existingTab?: Window | null) => {
    if (existingTab && !existingTab.closed) {
      existingTab.location.href = url;
      return;
    }
    const tab = window.open(url, '_blank');
    if (tab) tab.opener = null;
  };

  const handleRegisterAndSendOtp = async () => {
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

    if (cart.simType === 'esim' && !/^\d{4}-\d{2}-\d{2}$/.test(cart.tripArrivalDate ?? '')) {
      setActivationDateError('Please choose a valid eSIM activation date.');
      return;
    }
    if (!trimmedName) {
      setRegisterError('Please enter your full name.');
      return;
    }
    if (!nationality.trim()) {
      setRegisterError('Please select your nationality.');
      return;
    }
    if (!trimmedEmail || !emailOk) {
      setRegisterError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setRegisterError('Password must be at least 8 characters.');
      return;
    }
    if (password !== passwordConfirm) {
      setRegisterError('Passwords do not match.');
      return;
    }
    if (!acceptedLegal) {
      setLegalError('Please confirm that you agree to the Terms & Conditions and Privacy Policy.');
      return;
    }

    setRegisterError('');
    setLegalError('');
    setActivationDateError('');
    setRegisterSubmitting(true);
    try {
      const result = await AuthApi.register({
        name: trimmedName,
        email: trimmedEmail,
        password,
      });

      if (!result.ok) {
        setRegisterError(apiErrorMessage(result.body, `Registration failed (HTTP ${result.status}).`));
        return;
      }

      const token = extractAuthTokenFromBody(result.body);
      if (token) localStorage.setItem('token', token);

      const userId = extractUserIdFromRegisterBody(result.body);
      if (!userId) {
        setRegisterError('Registration succeeded but no user id was returned by the API.');
        return;
      }
      setRegisteredUserId(userId);

      localStorage.setItem(
        'user',
        JSON.stringify({ email: trimmedEmail, name: trimmedName, id: userId, email_verified: false })
      );
      window.dispatchEvent(new Event(AUTH_STORAGE_SYNC));
      setEmail(trimmedEmail);
      setFullName(trimmedName);

      setOtpError('');
      setOtpInfo(
        result.body &&
          typeof result.body === 'object' &&
          (result.body as { verification_email_sent?: boolean }).verification_email_sent === false
          ? apiErrorMessage(
              result.body,
              'Account created, but we could not send the verification email. Use resend code below.'
            )
          : ''
      );
      setOtp('');
      setStep('otp');
    } catch (e: unknown) {
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setRegisterError(fallback || 'Registration request failed.');
    } finally {
      setRegisterSubmitting(false);
    }
  };

  type OrderCheckoutResult = {
    paymentUrl: string | null;
    orderId?: string | number;
    draftId?: string;
    status?: string;
  };

  const createOrderForCheckout = async (userId: number): Promise<OrderCheckoutResult> => {
    const payload = buildOrderPayload(userId);
    let orderRes = await OrderApi.create(payload);

    if (!orderRes.ok) {
      throw new Error(apiErrorMessage(orderRes.body, `Order submission failed (HTTP ${orderRes.status}).`));
    }

    const stored = orderRes.body as Record<string, unknown>;
    const summary = (stored?.data ?? stored) as Record<string, unknown>;
    const orderRecord = summary?.order as Record<string, unknown> | undefined;
    const rawOrderId =
      orderRecord?.id ?? summary?.order_id ?? stored?.order_id ?? null;
    const orderId =
      typeof rawOrderId === 'number' || typeof rawOrderId === 'string' ? rawOrderId : null;

    const draftId =
      typeof summary?.draft_id === 'string' ? summary.draft_id : orderDraftId;
    const paymentUrl = normalizePaymentUrl(extractPaymentUrl(orderRes.body));

    const result: OrderCheckoutResult = {
      paymentUrl,
      orderId: orderId ?? undefined,
      draftId,
      status: typeof summary?.status === 'string' ? summary.status : undefined,
    };

    setOrderStoredSummary({
      order_id: result.orderId,
      draft_id: draftId,
      payment_url: paymentUrl ?? undefined,
      status: result.status,
      total_amount: summary?.total_amount as number | string | undefined,
      currency: summary?.currency as string | undefined,
    });
    return result;
  };

  const handleVerifyOtp = async () => {
    const normalized = otp.replace(/\D/g, '').trim();
    if (!/^\d{6}$/.test(normalized)) {
      setOtpError('Please enter the 6-digit verification code.');
      return;
    }

    setOtpError('');
    setOtpInfo('');
    setVerifyingOtp(true);
    try {
      const userId = registeredUserId ?? getStoredUserId();
      if (!userId) {
        setOtpError('Account verified but user id is missing. Please sign in and try again.');
        return;
      }

      const verifyRes = await AuthApi.verifyEmail({ email: email.trim(), code: normalized });
      if (!verifyRes.ok) {
        setOtpError(apiErrorMessage(verifyRes.body, `Verification failed (HTTP ${verifyRes.status}).`));
        return;
      }

      await createOrderForCheckout(userId);

      try {
        const raw = localStorage.getItem('user');
        if (raw) {
          const u = JSON.parse(raw) as Record<string, unknown>;
          u.email_verified = true;
          localStorage.setItem('user', JSON.stringify(u));
          window.dispatchEvent(new Event(AUTH_STORAGE_SYNC));
        }
      } catch {
        // ignore malformed stored user data
      }

      setStep('payment');
    } catch (e: unknown) {
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setOtpError(fallback || 'Verification failed.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendSecondsLeft > 0) return;
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      setOtpError('Please sign in again to resend the verification code.');
      setOtpInfo('');
      return;
    }

    setOtpError('');
    setOtpInfo('');
    setResendingOtp(true);
    try {
      const res = await AuthApi.resendVerificationEmail();
      if (!res.ok) {
        setOtpError(apiErrorMessage(res.body, `Could not resend code (HTTP ${res.status}).`));
        return;
      }
      setOtpInfo(
        apiErrorMessage(res.body, 'Verification code sent to your email.')
      );
      setResendCooldownEndsAt(Date.now() + 30_000);
    } catch (e: unknown) {
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setOtpError(fallback || 'Could not resend code.');
    } finally {
      setResendingOtp(false);
    }
  };

  const savePendingPayment = (opts: {
    emailOverride?: string;
    orderId?: string | number;
    draftId?: string;
  }) => {
    const payEmail = (opts.emailOverride ?? email).trim();
    localStorage.setItem(
      'pendingPayment',
      JSON.stringify({
        order_id: opts.orderId,
        draft_id: opts.draftId ?? orderDraftId,
        items: [{ bundle: cart.bundle, quantity: 1 }],
        trip: {
          countryName: cart.countryName,
          arrivalDate: cart.tripArrivalDate,
          departureDate: cart.tripDepartureDate,
          duration:
            cart.tripArrivalDate && cart.tripDepartureDate
              ? tripInclusiveDays(cart.tripArrivalDate, cart.tripDepartureDate)
              : undefined,
        },
        simType: cart.simType,
        total,
        currency,
        email: payEmail,
        createdAt: new Date().toISOString(),
      })
    );
  };

  const extractUserIdFromRegisterBody = (body: unknown): number | null => {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    const user = b.user;
    if (user && typeof user === 'object') {
      const u = user as Record<string, unknown>;
      const id = u.id;
      if (typeof id === 'number') return id;
      if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
    }
    const data = b.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      const maybeUser = d.user;
      if (maybeUser && typeof maybeUser === 'object') {
        const u = maybeUser as Record<string, unknown>;
        const id = u.id;
        if (typeof id === 'number') return id;
        if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
      }
    }
    return null;
  };

  const buildOrderPayload = (userId: number) => {
    const { tripArrivalDate: fallbackArrival, tripDepartureDate: fallbackDeparture } =
      defaultActivationDates();
    const arrival = cart.tripArrivalDate ?? fallbackArrival;
    const departure = cart.tripDepartureDate ?? fallbackDeparture;
    const duration = tripInclusiveDays(arrival, departure);

    const topUp = cart.checkoutMode === 'topup' || isTopUpFlow;

    return {
      draft_id: orderDraftId,
      user_id: userId,
      checkoutMode: cart.checkoutMode ?? (isTopUpFlow ? 'topup' : 'standard'),
      ...(topUp && cart.user_esim_id
        ? { user_esim_id: cart.user_esim_id }
        : {}),
      ...(topUp && cart.msisdn ? { msisdn: cart.msisdn } : {}),
      country: cart.country,
      countryName: cart.countryName,
      simType: cart.simType,
      trip: {
        destination_country: cart.country,
        arrival_date: arrival,
        departure_date: departure,
        duration_days: duration,
      },
      items: [
        {
          type: 'bundle',
          bundle_id: Number(cart.bundle.id),
          sim_bundle_id: cart.bundle.sim_bundle_id ?? null,
          bundle_name: cart.bundle.name,
          data_amount: cart.bundle.data_mb ?? null,
          validity_days: cart.bundle.validity_days ?? 30,
          price: Number(cart.bundle.price ?? 0),
          currency: (cart.bundle.currency ?? currency) as string,
        },
      ],
      pricing: {
        subtotal: total,
        discount_amount: 0,
        discount_code: null,
        total_amount: total,
        currency,
      },
      kyc: {
        passport_id: KYC_PLACEHOLDER.passport_id,
        // API max 10 chars — use destination ISO code (e.g. TZ), not a sentence
        passport_country: (cart.country || 'TZ').slice(0, 10),
        nationality: nationality.trim() || KYC_PLACEHOLDER.nationality,
        gender: KYC_PLACEHOLDER.gender,
        reason_for_travel: KYC_PLACEHOLDER.reason_for_travel,
      },
      payment: {
        status: 'pending',
      },
      order_metadata: {
        source: 'web',
        platform: 'web',
        created_at: new Date().toISOString(),
      },
    };
  };

  /** Payment step — creates order if needed, then opens payment in a new tab and returns to dashboard. */
  const handleContinueToPaymentClick = async () => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      setStep('register');
      return;
    }

    if (isTopUpFlow && (!cart?.user_esim_id || !cart?.msisdn)) {
      alert('Select the SIM to top up from your dashboard, then try again.');
      router.push('/dashboard');
      return;
    }

    const paymentTab = beginPaymentTab();

    setPaying(true);
    try {
      const userId = registeredUserId ?? getStoredUserId();
      let orderId = orderStoredSummary?.order_id;
      let draftId = orderStoredSummary?.draft_id;
      let paymentUrl = normalizePaymentUrl(orderStoredSummary?.payment_url);

      if (!orderId && userId) {
        const created = await createOrderForCheckout(userId);
        orderId = created.orderId ?? orderId;
        draftId = created.draftId ?? draftId;
        paymentUrl = created.paymentUrl ?? paymentUrl;
      }

      if (!orderId) {
        throw new Error('Could not start payment. No order was created.');
      }

      const targetUrl = resolvePaymentTargetUrl(paymentUrl, {
        amount: total,
        currency,
        email: email.trim(),
        country: cart.country,
        countryName: cart.countryName,
        simType: cart.simType,
        orderId,
        draftId,
      });

      savePendingPayment({ orderId, draftId });

      if (isTopUpFlow && cart) {
        const purchasedDataMb = Number(cart.bundle.data_mb) || 0;
        startBalancePoll({
          msisdn: cart.msisdn,
          purchasedDataMb,
          currentDataMb: cart.current_data_mb,
        });
      }

      openPaymentInNewTab(targetUrl, paymentTab);
      try {
        sessionStorage.setItem('travela:showReceiptPrompt', '1');
        if (orderId != null) {
          sessionStorage.setItem('travela:receiptOrderId', String(orderId));
        }
      } catch {
        /* ignore */
      }
      router.push('/dashboard');
    } catch (e: unknown) {
      if (paymentTab && !paymentTab.closed) paymentTab.close();
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      alert(fallback || 'Could not continue to payment.');
    } finally {
      setPaying(false);
      setShowPaymentRedirectDialog(false);
    }
  };

  const visibleSteps = isTopUpFlow ? TOPUP_STEPS : STEPS;
  const currentStepIdx = visibleSteps.findIndex((s) => s.id === step);

  if (step === 'success' && isTopUpFlow) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${checkoutPageTransitionClass(checkoutRevealed)}`}
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <Loader2 size={28} className="animate-spin text-slate-400" />
      </div>
    );
  }

  // ── Success (standard checkout only) ─────────────────────────────────────────
  if (step === 'success') {
    return (
      <div
        className={`min-h-screen ${checkoutPageTransitionClass(checkoutRevealed)}`}
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: 'rgba(23,207,84,0.14)' }}
          >
            <CheckCircle size={40} style={{ color: '#17cf54' }} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 mb-2">You&apos;re all set!</h1>
          <p className="text-slate-500 text-sm mb-2 leading-relaxed">
            {cart.simType === 'esim' ? (
              <>
                Your eSIM is scheduled to activate on{' '}
                <strong className="text-slate-700">
                  {cart.tripArrivalDate ? formatDisplayDate(cart.tripArrivalDate) : 'your activation date'}
                </strong>
                . We&apos;ll email your QR code and setup steps — install it on your activation date to get online. Your plan includes 30 days of data from activation.
              </>
            ) : (
              'Your physical SIM card order is confirmed. We will be in touch for collection or delivery.'
            )}
          </p>
          <p className="text-slate-500 text-sm mb-8">
            A transaction confirmation has been sent to <strong>{email}</strong>.
          </p>

          {/* App download CTA */}
          <div
            className="rounded-2xl p-6 mb-8 border text-left"
            style={{ backgroundColor: '#112116', borderColor: '#112116' }}
          >
            <div className="flex items-start gap-4">
              <div
                className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center"
                style={{ backgroundColor: 'rgba(23,207,84,0.15)' }}
              >
                <Smartphone size={24} style={{ color: '#17cf54' }} />
              </div>
              <div className="flex-1">
                <p className="text-white font-extrabold text-base mb-1">Track your usage on the go</p>
                <p className="text-white/60 text-sm mb-4 leading-relaxed">
                  Download the Travela app to monitor your data balance, manage your SIM, get top-up reminders, and access 24/7 support — all from your pocket.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href="#"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-white/20 text-white hover:bg-white/10 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                    App Store
                  </a>
                  <a
                    href="#"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-white/20 text-white hover:bg-white/10 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.18 23.76c.3.17.64.24.99.19l12.6-7.27-2.79-2.79-10.8 9.87zm-1.9-20.7C1.1 3.4 1 3.75 1 4.13v15.74c0 .38.1.73.28 1.04l.06.05 8.82-8.82v-.2L1.34 3.01l-.06.05zm17.54 8.49l-2.52-1.46-3.14 3.13 3.14 3.14 2.54-1.47c.72-.42.72-1.1 0-1.52l-.02.18zM4.17.24L16.77 7.5l-2.79 2.79L3.18.42A1.2 1.2 0 0 1 4.17.24z"/></svg>
                    Google Play
                  </a>
                </div>
              </div>
            </div>
          </div>

          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 w-full py-4 rounded-xl text-base font-bold text-white hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#112116' }}
          >
            Go to My Dashboard <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    );
  }

  // ── Layout wrapper ─────────────────────────────────────────────────────────
  return (
    <div
      className={`min-h-screen ${checkoutPageTransitionClass(checkoutRevealed)}`}
      style={{ backgroundColor: '#f6f8f6' }}
    >
      {/* Back + steps — same width as the body cards */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-5">
          <button
            onClick={() => {
              if (step === 'register') router.push('/bundles?country=TZ&countryName=Tanzania');
              else if (step === 'otp') setStep('register');
              else if (step === 'payment') {
                if (isTopUpFlow) router.push('/bundles?country=TZ&countryName=Tanzania&topup=1');
                else setStep('otp');
              }
            }}
            className="text-slate-400 hover:text-slate-700 transition-colors mb-4"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-start w-full">
            {visibleSteps.map((s, i) => {
              const isFirst = i === 0;
              const isLast = i === visibleSteps.length - 1;
              return (
                <div key={s.id} className={`flex items-start min-w-0 ${isLast ? '' : 'flex-1'}`}>
                  <div
                    className={`flex flex-col gap-1 flex-shrink-0 ${
                      isFirst && !isLast ? 'items-start' : isLast ? 'items-end' : 'items-center'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold transition-colors"
                      style={
                        i < currentStepIdx
                          ? { backgroundColor: '#17cf54', color: '#112116' }
                          : i === currentStepIdx
                          ? { backgroundColor: '#112116', color: 'white' }
                          : { backgroundColor: '#e2e8f0', color: '#94a3b8' }
                      }
                    >
                      {i < currentStepIdx ? <Check size={14} /> : i + 1}
                    </div>
                    <span
                      className="text-xs font-semibold hidden sm:block whitespace-nowrap"
                      style={{ color: i <= currentStepIdx ? '#112116' : '#94a3b8' }}
                    >
                      {s.label}
                    </span>
                  </div>
                  {!isLast && (
                    <div
                      className="h-0.5 flex-1 mx-2 mt-4 rounded transition-colors"
                      style={{ backgroundColor: i < currentStepIdx ? '#17cf54' : '#e2e8f0' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* ── STEP 1: REGISTER ─────────────────────────────────────────── */}
        {step === 'register' && (
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 mb-1">Create your account</h2>
            <p className="text-sm text-slate-500 mb-6">
              Register to complete checkout. You&apos;ll confirm with a code on the next step.
            </p>

            {/* Order summary */}
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 mb-6">
              <div className="flex items-center gap-4 p-5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(17,33,22,0.07)' }}
                >
                  {cart.simType === 'esim'
                    ? <Wifi size={18} style={{ color: '#112116' }} />
                    : <Smartphone size={18} style={{ color: '#112116' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-900">{cart.bundle.name}</p>
                  <p className="text-sm font-bold text-slate-800">{formatMb(cart.bundle.data_mb)}</p>
                  <p className="text-xs text-slate-500">
                    {cart.bundle.validity_days ?? 30} days ·{' '}
                    {cart.simType === 'esim' ? 'eSIM' : 'Physical SIM'}
                  </p>
                </div>
                <p className="text-sm font-extrabold text-slate-900 flex-shrink-0">
                  {currency} {total.toFixed(2)}
                </p>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <span className="font-extrabold text-slate-900">Total</span>
                <span className="text-lg font-extrabold" style={{ color: '#112116' }}>
                  {currency} {total.toFixed(2)}
                </span>
              </div>
            </div>

            {/* eSIM activation date */}
            {cart.simType === 'esim' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                  eSIM Activation Date
                </label>
                <div className="relative">
                  <Calendar size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="date"
                    min={todayIso()}
                    value={cart.tripArrivalDate ?? todayIso()}
                    onChange={(e) => handleActivationDateChange(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-slate-400"
                  />
                </div>
                {activationDateError && (
                  <p className="text-xs font-medium text-red-600 mt-2">{activationDateError}</p>
                )}
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Defaults to today. Change it if you want your eSIM to activate on a later date.
                </p>
                <p className="text-xs font-semibold mt-2 leading-relaxed" style={{ color: '#112116' }}>
                  Your plan is valid for {validityDays} days from activation. It will expire on{' '}
                  {formatDisplayDate(expiryDate)}.
                </p>
                {cart.tripArrivalDate && cart.tripArrivalDate > todayIso() && (
                  <p
                    className="text-xs font-semibold mt-2 rounded-lg px-3 py-2"
                    style={{ backgroundColor: 'rgba(217,119,6,0.1)', color: '#b45309' }}
                  >
                    Your eSIM will activate on {formatDisplayDate(cart.tripArrivalDate)}, not immediately after
                    payment.
                  </p>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 mb-6">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                  Full Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                  Nationality <span className="text-red-400">*</span>
                </label>
                <select
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:border-slate-400"
                >
                  <option value="" disabled>
                    Select your nationality
                  </option>
                  {NATIONALITIES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                  Email Address <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                  Password <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 pr-11 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                  Confirm Password <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPasswordConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="w-full px-4 pr-11 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    aria-label={showPasswordConfirm ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setShowPasswordConfirm((v) => !v)}
                  >
                    {showPasswordConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <LegalAcceptance
                checked={acceptedLegal}
                onChange={(value) => {
                  setAcceptedLegal(value);
                  if (value) setLegalError('');
                }}
                error={legalError}
              />
            </div>

            {registerError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-4">
                <p className="text-sm font-medium text-red-700">{registerError}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleRegisterAndSendOtp()}
              disabled={registerSubmitting}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#112116' }}
            >
              {registerSubmitting
                ? <><Loader2 size={18} className="animate-spin" /> Creating…</>
                : <>Continue <ArrowRight size={18} /></>}
            </button>
          </div>
        )}

        {/* ── STEP 2: OTP ──────────────────────────────────────────────── */}
        {step === 'otp' && (
          <div className="max-w-md mx-auto text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ backgroundColor: 'rgba(17,33,22,0.08)' }}
            >
              <Mail size={28} style={{ color: '#112116' }} />
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 mb-2">Verification code</h2>
            <p className="text-sm text-slate-500 mb-8 leading-relaxed">
              Enter the 6-digit code we sent to{' '}
              <span className="font-semibold text-slate-700">{email || 'your email'}</span>
            </p>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4 text-left">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
                Verification Code
              </label>
              <input
                type="text"
                placeholder="Enter code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-lg font-bold text-slate-900 tracking-[0.3em] text-center placeholder-slate-300 focus:outline-none focus:border-slate-400"
              />
              {otpInfo && !otpError && (
                <p className="text-xs font-medium text-emerald-700 mt-2">{otpInfo}</p>
              )}
              {otpError && (
                <p className="text-xs font-medium text-red-600 mt-2">{otpError}</p>
              )}
              <div className="flex items-center justify-between mt-4">
                <button
                  type="button"
                  onClick={() => void handleResendOtp()}
                  disabled={resendingOtp || resendSecondsLeft > 0}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  {resendingOtp
                    ? 'Sending…'
                    : resendSecondsLeft > 0
                      ? `Resend code (${resendSecondsLeft}s)`
                      : 'Resend code'}
                </button>
                <span className="text-[11px] text-slate-400">Check spam/junk if you don’t see it.</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleVerifyOtp()}
              disabled={verifyingOtp || !/^\d{6}$/.test(otp.trim())}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#112116' }}
            >
              {verifyingOtp
                ? <><Loader2 size={18} className="animate-spin" /> Verifying…</>
                : <>Verify &amp; Continue to Payment <ArrowRight size={18} /></>}
            </button>
          </div>
        )}

        {/* ── STEP 3: PAYMENT ──────────────────────────────────────────── */}
        {step === 'payment' && (
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 mb-1">Payment</h2>
            <p className="text-sm text-slate-500 mb-6">
              {isTopUpFlow
                ? 'Top up your bundle by completing payment below.'
                : 'You’re ready to pay. Payment will open in a new tab on our secure payment platform.'}
            </p>

            {/* Order mini-summary */}
            <div
              className="rounded-xl px-4 py-3 mb-6 flex items-center justify-between border"
              style={{ backgroundColor: 'rgba(17,33,22,0.03)', borderColor: 'rgba(17,33,22,0.1)' }}
            >
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {formatMb(cart.bundle.data_mb)} ({cart.bundle.name})
                </p>
                <p className="text-xs text-slate-500">
                  {cart.simType === 'esim' ? 'eSIM' : 'Physical SIM'} · {cart.countryName}
                  {cart.simType === 'esim' && cart.tripArrivalDate && (
                    <>
                      {' · '}
                      Activate {formatDisplayDate(cart.tripArrivalDate)}
                    </>
                  )}
                </p>
              </div>
              <p className="text-base font-extrabold" style={{ color: '#112116' }}>
                {currency} {total.toFixed(2)}
              </p>
            </div>

            {/* Redirect information card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
              <div className="flex items-start gap-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(17,33,22,0.07)' }}
                >
                  <CreditCard size={22} style={{ color: '#112116' }} />
                </div>
                <div className="flex-1">
                  <p className="text-base font-extrabold text-slate-900 mb-1">Pay on a secure payment page</p>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    When you continue, payment opens in a new tab on our secure payment partner. After you pay,
                    return here or check your dashboard for confirmation.
                  </p>

                  <div className="mt-4 grid sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Amount</p>
                      <p className="text-sm font-extrabold text-slate-900 mt-1">
                        {currency} {total.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Email</p>
                      <p className="text-sm font-extrabold text-slate-900 mt-1">{email || '—'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-4">
                    <Lock size={12} />
                    <span>We never collect or store your card details on Travela.</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowPaymentRedirectDialog(true)}
              disabled={paying}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#112116' }}
            >
              {paying
                ? <><Loader2 size={18} className="animate-spin" /> Opening payment…</>
                : <>Continue to Payment <ArrowRight size={18} /></>}
            </button>
          </div>
        )}
      </div>

      {/* Payment redirect confirmation */}
      {showPaymentRedirectDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-redirect-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label="Close"
            disabled={paying}
            onClick={() => {
              if (!paying) setShowPaymentRedirectDialog(false);
            }}
          />
          <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-6 sm:p-7">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(17,33,22,0.08)', color: '#112116' }}
                >
                  <CreditCard size={24} />
                </div>
                <button
                  type="button"
                  disabled={paying}
                  onClick={() => setShowPaymentRedirectDialog(false)}
                  className="p-2 -mr-1 -mt-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                  aria-label="Close dialog"
                >
                  <X size={20} />
                </button>
              </div>

              <h2 id="payment-redirect-title" className="text-xl font-extrabold text-slate-900 mb-2">
                You&apos;ll leave Travela briefly
              </h2>
              <p className="text-sm text-slate-500 leading-relaxed mb-5">
                Next, we open a secure payment page in another tab. Complete payment there, then come
                back here to Travela. Your order and receipt stay on this site.
              </p>

              <ol className="space-y-3 text-sm text-slate-700 mb-6">
                <li className="flex gap-3">
                  <span
                    className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: '#112116' }}
                  >
                    1
                  </span>
                  <span>Payment opens in a new tab on our payment partner.</span>
                </li>
                <li className="flex gap-3">
                  <span
                    className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: '#112116' }}
                  >
                    2
                  </span>
                  <span>Pay the amount due, then close that tab when finished.</span>
                </li>
                <li className="flex gap-3">
                  <span
                    className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: '#112116' }}
                  >
                    3
                  </span>
                  <span>
                    Return to Travela. You can download your purchase receipt from your dashboard.
                  </span>
                </li>
              </ol>

              <div
                className="rounded-xl border border-slate-200 px-4 py-3 mb-5 flex items-center justify-between gap-3"
                style={{ backgroundColor: '#f6f8f6' }}
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Paying</p>
                  <p className="text-sm font-extrabold text-slate-900">
                    {formatMb(cart.bundle.data_mb)} ({cart.bundle.name})
                  </p>
                </div>
                <p className="text-base font-extrabold flex-shrink-0" style={{ color: '#112116' }}>
                  {currency} {total.toFixed(2)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleContinueToPaymentClick()}
                disabled={paying}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#112116' }}
              >
                {paying ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Opening payment…
                  </>
                ) : (
                  <>
                    Open payment page <ArrowRight size={18} />
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={paying}
                onClick={() => setShowPaymentRedirectDialog(false)}
                className="w-full mt-2 py-3 text-sm font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
