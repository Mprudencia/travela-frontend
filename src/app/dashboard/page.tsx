'use client';

import ActivateEsimButton from '@/components/esim/ActivateEsimButton';
import AssignSimPrompt from '@/components/esim/AssignSimPrompt';
import QrCodePanel from '@/components/esim/QrCodePanel';
import {
  apiErrorMessage,
  BundlesApi,
  EsimsApi,
  OrderApi,
  type EsimAssignmentPayload,
  type EsimAssignmentStatus,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getBalancePollContext } from '@/lib/balance-poll';
import { PLAN_VALIDITY_DAYS, plannedExpiryDate, hasPlanExpired, activationToday } from '@/lib/plan-validity';
import { displayBundleName } from '@/lib/bundles';
import { dataMbFromAssignment } from '@/lib/esim-balance';
import { resolvePaymentTargetUrl, extractPaymentUrl, normalizePaymentUrl } from '@/lib/payment';
import { useBalancePoll } from '@/hooks/useBalancePoll';
import {
  CheckCircle,
  Clock,
  CreditCard,
  Download,
  Globe,
  Info,
  Loader2,
  MapPin,
  Package,
  Receipt,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface PurchaseData {
  items?: {
    bundle: {
      name: string;
      data_mb?: number;
      validity_days?: number;
      price?: string | number;
      currency?: string;
    };
    quantity: number;
  }[];
  trip?: {
    countryName?: string;
    duration?: number;
    arrivalDate?: string;
    departureDate?: string;
  };
  total?: number;
  currency?: string;
  orderId?: string | number;
  draftId?: string;
  simType?: string;
  date?: string;
}

interface PendingPaymentData {
  order_id?: string | number;
  draft_id?: string;
  payment_url?: string;
  simType?: string;
  country?: string;
  countryName?: string;
  items?: PurchaseData['items'];
  trip?: PurchaseData['trip'];
  total?: number;
  currency?: string;
  email?: string;
}

interface OrderItemRecord {
  id: number;
  bundle_name: string;
  data_amount: number | null;
  validity_days: number;
  price: string;
  currency: string;
}

interface OrderRecord {
  id: number;
  draft_id: string;
  payment_reference: string | null;
  status: string;
  payment_status: string;
  total_amount: string;
  currency: string;
  paid_at: string | null;
  created_at: string;
  payment_payload?: { response?: { paymentUrl?: string | null } } | null;
  metadata?: {
    countryName?: string;
    simType?: string;
    country?: string;
    checkoutMode?: string;
  } | null;
  trip?: {
    destination_country?: string;
    arrival_date?: string;
    departure_date?: string;
    duration_days?: number;
  } | null;
  order_items?: OrderItemRecord[];
}

interface PhysicalPickupDetails {
  draftId?: string;
  orderId?: string | number;
  countryName?: string;
  deactivationDate?: string | null;
  items: {
    name: string;
    dataLabel: string;
    validityDays?: number;
    price?: string;
    currency?: string;
  }[];
  total?: string;
  currency?: string;
  paymentReference?: string | null;
  status?: string;
}

interface EsimDetail {
  id: number;
  sim_id?: number | null;
  msisdn?: string | null;
  phone_number?: string | null;
  iccid?: string | null;
  description?: string | null;
  status?: string | null;
  sale_status?: string | null;
  sim_type?: string | null;
  provider_status?: string | null;
  qr_code_data?: string | null;
  has_activation_data?: boolean;
}

interface BundleDetail {
  id?: number;
  name?: string | null;
  alias?: string | null;
  type?: string | null;
  type_name?: string | null;
  data_mb?: number | null;
  validity_days?: number | null;
  duration_days?: number | null;
  duration?: string | null;
}

interface EsimsListResponse {
  esims: UserEsimRecord[];
  latestOrderBundle: BundleDetail | null;
  assignmentPrompt: { status?: string; activation_date?: string | null; order_id?: number | null } | null;
}

interface OrderItemDetail {
  id?: number;
  data_amount?: number | null;
  bundle_name?: string | null;
  validity_days?: number | null;
}

interface OrderDetail {
  metadata?: {
    country?: string;
    countryName?: string;
    simType?: string;
  };
}

interface TopUpBundle {
  id: string | number;
  sim_bundle_id?: number | null;
  name: string;
  data_mb?: number;
  validity_days?: number;
  price?: string | number;
  currency?: string;
  description?: string;
  tagline?: string;
}

type ApiBundle = {
  id: number;
  sim_bundle_id?: number | null;
  name: string;
  alias?: string | null;
  validity_days?: number | null;
  price?: string | number | null;
  currency?: string | null;
  data_mb?: number | null;
  bundle_size?: string | number | null;
  bundle_size_in_mb?: number | null;
  unit?: string | null;
  metadata?: Record<string, unknown> | null;
  price_usd?: string | number | null;
};

type BundlesResponse = { bundles: ApiBundle[] };

interface UserEsimRecord {
  id: number;
  esim_id: number;
  balance?: string | null;
  balance_currency?: string | null;
  balance_fetched_at?: string | null;
  balances?: Record<string, unknown> | null;
  device_activated_at?: string | null;
  plan_started_at?: string | null;
  plan_expires_at?: string | null;
  activation_email_sent_at?: string | null;
  created_at?: string | null;
  esim?: EsimDetail | null;
  bundle?: BundleDetail | null;
  order_item?: OrderItemDetail | null;
  order?: OrderDetail | null;
}

const DEFAULT_RETRY_SECONDS = 300;
const TOPUP_MODAL_TRANSITION_MS = 320;
const CHECKOUT_TRANSITION_KEY = 'travela:checkout-transition';

type WatcherSignal = {
  cancelled: boolean;
  timeoutId?: number;
};

function sleep(ms: number, signal: WatcherSignal) {
  return new Promise<void>((resolve) => {
    if (signal.cancelled) {
      resolve();
      return;
    }
    signal.timeoutId = window.setTimeout(() => resolve(), ms);
  });
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeBundle(raw: unknown): BundleDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const data_mb = coerceNumber(b.data_mb);
  const validity_days = coerceNumber(b.validity_days) ?? coerceNumber(b.duration_days);
  return {
    id: coerceNumber(b.id),
    name: typeof b.name === 'string' ? b.name : null,
    alias: typeof b.alias === 'string' ? b.alias : null,
    type: typeof b.type === 'string' ? b.type : null,
    type_name: typeof b.type_name === 'string' ? b.type_name : null,
    data_mb: data_mb ?? null,
    validity_days: validity_days ?? null,
    duration_days: coerceNumber(b.duration_days) ?? null,
    duration: typeof b.duration === 'string' ? b.duration : null,
  };
}

function formatMb(mb?: number | null) {
  if (mb == null || mb <= 0) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb.toLocaleString()} MB`;
}

/** Consistent "Internet - 30 days - 25 MB" style label, regardless of how the raw API `name` is formatted. */
function bundleTagline(validityDays?: number | null, mb?: number) {
  const days = validityDays ?? 30;
  return `Internet - ${days} days - ${formatMb(mb)}`;
}

/**
 * Fallback titles by data size, used only while the backend hasn't set an `alias`
 * for a bundle yet. Keeps naming consistent even before every bundle has an alias.
 */
const BUNDLE_NAME_BY_MB: Record<number, string> = {
  25: 'Starter',
  10240: 'Nomad',
  15360: 'Nomad plus',
  30720: 'Heavy user',
  51200: 'Streamer',
};

function fallbackBundleName(mb?: number): string | undefined {
  if (mb == null) return undefined;
  return BUNDLE_NAME_BY_MB[mb];
}

function bundleToMb(bundle: ApiBundle): number | undefined {
  const direct = coerceNumber(bundle.data_mb);
  if (direct != null && direct > 0) return direct;

  const sizeInMb = coerceNumber(bundle.bundle_size_in_mb);
  if (sizeInMb != null && sizeInMb > 0) return sizeInMb;

  const size = coerceNumber(bundle.bundle_size);
  if (size == null) return undefined;

  const unit = (bundle.unit ?? '').toUpperCase();
  if (unit === 'GB') return Math.round(size * 1024);
  if (unit === 'MB') return Math.round(size);
  return undefined;
}

/** Balance area shows live DATA from user_esims.balances. */
function displayDataBalance(dataMb?: number | null) {
  if (dataMb == null || !Number.isFinite(dataMb)) return '—';
  if (dataMb >= 1024) return `${(dataMb / 1024).toFixed(0)} GB`;
  return `${Math.round(dataMb).toLocaleString()} MB`;
}

function formatTripDate(iso?: string | null) {
  if (!iso) return null;
  const datePart = iso.includes('T') ? iso.split('T')[0] : iso;
  return new Date(datePart + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toDatePart(iso?: string | null): string | null {
  if (!iso) return null;
  const datePart = iso.includes('T') ? iso.split('T')[0] : iso;
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

function addDaysToIso(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Plans last `validityDays` from the start date (default 30). */
function deactivationIsoFrom(startIso?: string | null, validityDays = 30): string | null {
  const start = toDatePart(startIso);
  if (!start) return null;
  return addDaysToIso(start, validityDays);
}

function daysUntil(iso?: string | null): number | null {
  const datePart = toDatePart(iso);
  if (!datePart) return null;
  const end = new Date(datePart + 'T12:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

function daysLeftLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days < 0) return 'Expired';
  if (days === 0) return 'Last day';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

function parseEsimsFromBody(body: unknown): EsimsListResponse {
  if (!body || typeof body !== 'object') {
    return { esims: [], latestOrderBundle: null, assignmentPrompt: null };
  }

  const b = body as { data?: unknown; latest_order?: unknown; assignment_prompt?: unknown };
  const esims: UserEsimRecord[] = Array.isArray(b.data)
    ? b.data
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((record) => ({
          ...(record as unknown as UserEsimRecord),
          bundle: normalizeBundle(record.bundle),
        }))
    : [];

  let latestOrderBundle: BundleDetail | null = null;
  if (b.latest_order && typeof b.latest_order === 'object') {
    const latestOrder = b.latest_order as Record<string, unknown>;
    latestOrderBundle = normalizeBundle(latestOrder.bundle);
  }

  let assignmentPrompt: EsimsListResponse['assignmentPrompt'] = null;
  if (b.assignment_prompt && typeof b.assignment_prompt === 'object') {
    const prompt = b.assignment_prompt as Record<string, unknown>;
    assignmentPrompt = {
      status: typeof prompt.status === 'string' ? prompt.status : undefined,
      activation_date: typeof prompt.activation_date === 'string' ? prompt.activation_date : null,
      order_id: typeof prompt.order_id === 'number' ? prompt.order_id : null,
    };
  }

  return { esims, latestOrderBundle, assignmentPrompt };
}

function parseAssignmentStatus(body: unknown): EsimAssignmentStatus {
  if (!body || typeof body !== 'object') {
    return { has_sim: false };
  }

  const root = body as Record<string, unknown>;
  const source =
    root.has_sim != null || root.status != null
      ? root
      : root.data && typeof root.data === 'object'
        ? (root.data as Record<string, unknown>)
        : root;

  const has_sim = source.has_sim === true;
  const status = typeof source.status === 'string' ? source.status : undefined;
  const poll_again = source.poll_again === true;
  const retry_after_seconds =
    typeof source.retry_after_seconds === 'number'
      ? source.retry_after_seconds
      : undefined;
  const activation_date =
    typeof source.activation_date === 'string' ? source.activation_date : null;
  const order_id = typeof source.order_id === 'number' ? source.order_id : null;

  let inventory: EsimAssignmentStatus['inventory'];
  if (source.inventory && typeof source.inventory === 'object') {
    const inv = source.inventory as Record<string, unknown>;
    inventory = {
      available: typeof inv.available === 'number' ? inv.available : undefined,
    };
  }

  let data: EsimAssignmentPayload | undefined;
  if (source.data && typeof source.data === 'object') {
    const d = source.data as Record<string, unknown>;
    const esim =
      d.esim && typeof d.esim === 'object' ? (d.esim as EsimAssignmentPayload['esim']) : undefined;
    const bundle =
      d.bundle && typeof d.bundle === 'object'
        ? (d.bundle as EsimAssignmentPayload['bundle'])
        : undefined;
    if (esim || bundle) data = { esim, bundle };
  }

  return { has_sim, status, poll_again, retry_after_seconds, activation_date, order_id, inventory, data };
}

function shouldPollAssignment(status: EsimAssignmentStatus, justPaid: boolean): boolean {
  if (status.has_sim) return false;
  if (status.status === 'waiting_for_agent') return false;
  if (status.poll_again) return true;
  if (status.status === 'waiting_for_inventory') return true;
  return justPaid && status.status === 'payment_required';
}

function readPendingPaymentFromStorage(): PendingPaymentData | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('pendingPayment');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingPaymentData;
  } catch {
    return null;
  }
}

function readLastPurchaseFromStorage(): PurchaseData | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('lastPurchase');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PurchaseData;
  } catch {
    return null;
  }
}

function parseOrdersFromBody(body: unknown): OrderRecord[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as { data?: unknown };
  if (!Array.isArray(b.data)) return [];
  return b.data as OrderRecord[];
}

function isPaidOrder(order: OrderRecord): boolean {
  const status = (order.payment_status || order.status || '').toLowerCase();
  return status === 'paid' || status === 'completed';
}

/** Order was started but payment is still pending, failed, or abandoned — user can pay again. */
function isUnpaidPayableOrder(order: OrderRecord): boolean {
  if (isPaidOrder(order)) return false;
  if (order.paid_at) return false;
  const status = (order.payment_status || order.status || '').toLowerCase();
  const unpaid = new Set([
    'pending',
    'pending_payment',
    'unpaid',
    'failed',
    'payment_failed',
    'cancelled',
    'canceled',
    'expired',
    'awaiting_payment',
    'payment_required',
    'initiated',
    'created',
    'draft',
  ]);
  return unpaid.has(status) || !status;
}

function findLatestUnpaidOrder(orders: OrderRecord[]): OrderRecord | null {
  return (
    orders
      .filter(isUnpaidPayableOrder)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0] ?? null
  );
}

function unpaidStatusLabel(status?: string | null) {
  const s = (status ?? 'pending').toLowerCase();
  if (s.includes('fail')) return 'Payment failed';
  if (s.includes('cancel')) return 'Payment cancelled';
  if (s.includes('expir')) return 'Payment expired';
  return 'Payment pending';
}

function checkoutUrlFromOrder(order: OrderRecord | null | undefined): string | null {
  const payload = order?.payment_payload;
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const response =
    record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>)
      : null;
  const candidates = [
    response?.paymentUrl,
    response?.payment_url,
    response?.checkout_url,
    record.paymentUrl,
    record.payment_url,
    record.checkout_url,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function formatOrderItemData(mb?: number | null) {
  if (mb == null || mb <= 0) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

function resolvePhysicalPickupDetails(
  orders: OrderRecord[],
  _pendingPayment: PendingPaymentData | null,
  _purchase: PurchaseData | null
): PhysicalPickupDetails | null {
  const apiOrder = orders
    .filter((o) => o.metadata?.simType === 'physical' && isPaidOrder(o))
    .sort(
      (a, b) =>
        new Date(b.paid_at ?? b.created_at).getTime() -
        new Date(a.paid_at ?? a.created_at).getTime()
    )[0];

  if (apiOrder) {
    const items =
      apiOrder.order_items?.map((item) => ({
        name: item.bundle_name || 'Bundle',
        dataLabel: formatOrderItemData(item.data_amount),
        validityDays: item.validity_days,
        price: item.price,
        currency: item.currency ?? apiOrder.currency,
      })) ?? [];

    const validityDays = items[0]?.validityDays ?? 30;
    return {
      draftId: apiOrder.draft_id,
      orderId: apiOrder.id,
      countryName:
        apiOrder.metadata?.countryName ?? apiOrder.trip?.destination_country ?? undefined,
      deactivationDate:
        apiOrder.trip?.departure_date ??
        deactivationIsoFrom(
          apiOrder.trip?.arrival_date ?? apiOrder.paid_at ?? apiOrder.created_at,
          validityDays
        ),
      items,
      total: apiOrder.total_amount,
      currency: apiOrder.currency,
      paymentReference: apiOrder.payment_reference,
      status: apiOrder.payment_status || apiOrder.status,
    };
  }

  // Unpaid local pendingPayment / lastPurchase must not unlock pickup UI.
  return null;
}

function hasPhysicalSimPurchase(
  orders: OrderRecord[],
  pendingPayment: PendingPaymentData | null,
  purchase: PurchaseData | null
): boolean {
  return resolvePhysicalPickupDetails(orders, pendingPayment, purchase) != null;
}

function simTypeLabel(simType?: string | null) {
  const normalized = (simType ?? 'esim').toLowerCase();
  if (normalized === 'physical') return 'Physical SIM Card';
  return 'eSIM';
}

function isSimActive(status?: string | null) {
  return (status ?? '').toUpperCase() === 'MANAGED';
}

function simStatusLabel(status?: string | null) {
  return isSimActive(status) ? 'Active' : 'Inactive';
}

function esimDeviceStatusLabel(
  userEsim: UserEsimRecord | null,
  simStatus?: string | null
) {
  if (userEsim?.device_activated_at) return 'Active';
  if (isSimActive(simStatus)) return 'Ready to activate';
  return 'Inactive';
}

function formatMsisdn(msisdn?: string | null) {
  if (!msisdn) return null;
  return msisdn.startsWith('+') ? msisdn : `+${msisdn}`;
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const [purchase, setPurchase] = useState<PurchaseData | null>(() => readLastPurchaseFromStorage());
  const [pendingPayment, setPendingPayment] = useState<PendingPaymentData | null>(
    () => readPendingPaymentFromStorage()
  );
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [userEsims, setUserEsims] = useState<UserEsimRecord[]>([]);
  const [latestOrderBundle, setLatestOrderBundle] = useState<BundleDetail | null>(null);
  const [assignedSim, setAssignedSim] = useState<EsimAssignmentPayload | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [waitingForSim, setWaitingForSim] = useState(false);
  const [esimsError, setEsimsError] = useState('');
  const [showQrCode, setShowQrCode] = useState(false);
  const [assignPrompt, setAssignPrompt] = useState(false);
  const [promptActivationDate, setPromptActivationDate] = useState<string | null>(null);
  const [promptOrderId, setPromptOrderId] = useState<number | null>(null);
  const [assigningSim, setAssigningSim] = useState(false);
  const confirmationInFlightRef = useRef(false);
  const [rechargeNotice, setRechargeNotice] = useState('');
  const [promptError, setPromptError] = useState('');
  const [extendDate, setExtendDate] = useState('');
  const datePromptDismissedRef = useRef(false);
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpModalShown, setTopUpModalShown] = useState(false);
  const [topUpModalClosing, setTopUpModalClosing] = useState(false);
  const [topUpBundles, setTopUpBundles] = useState<TopUpBundle[]>([]);
  const [topUpBundlesLoading, setTopUpBundlesLoading] = useState(false);
  const [showReceiptPrompt, setShowReceiptPrompt] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
  const [retryPaying, setRetryPaying] = useState(false);
  const [retryPayError, setRetryPayError] = useState('');
  const ordersRef = useRef(orders);
  const purchaseRef = useRef(purchase);

  ordersRef.current = orders;
  purchaseRef.current = purchase;

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await OrderApi.listMine();
      if (!res.ok) {
        if (res.status === 401) {
          setOrders([]);
          return;
        }
        setOrders([]);
        return;
      }
      setOrders(parseOrdersFromBody(res.body));
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const loadEsims = useCallback(async () => {
    setEsimsError('');
    try {
      const res = await EsimsApi.listMine();
      if (!res.ok) {
        if (res.status === 401) {
          setUserEsims([]);
          setLatestOrderBundle(null);
          return;
        }
        const msg =
          res.body &&
          typeof res.body === 'object' &&
          typeof (res.body as { message?: unknown }).message === 'string'
            ? String((res.body as { message: string }).message)
            : `Could not load eSIMs (HTTP ${res.status}).`;
        setEsimsError(msg);
        setUserEsims([]);
        setLatestOrderBundle(null);
        return;
      }
      const parsed = parseEsimsFromBody(res.body);
      setUserEsims(parsed.esims);
      setLatestOrderBundle(parsed.latestOrderBundle);
      setWaitingForSim(parsed.assignmentPrompt?.status === 'activation_pending');
      if (parsed.assignmentPrompt?.status === 'awaiting_confirmation' && parsed.esims.length === 0) {
        const activationIso = parsed.assignmentPrompt.activation_date ?? null;
        setPromptActivationDate(activationIso);
        setPromptOrderId(parsed.assignmentPrompt.order_id ?? null);
        if (activationIso) {
          setExtendDate(activationIso.slice(0, 10));
        }
        if (!datePromptDismissedRef.current) {
          setAssignPrompt(true);
        }
      } else {
        datePromptDismissedRef.current = false;
        setAssignPrompt(false);
      }
    } catch (e: unknown) {
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setEsimsError(fallback || 'Failed to load eSIM details.');
      setUserEsims([]);
      setLatestOrderBundle(null);
    }
  }, []);

  const loadEsimsRef = useRef(loadEsims);
  loadEsimsRef.current = loadEsims;

  const { isPolling: balancePolling, confirmedDataMb } = useBalancePoll({
    onBalanceReady: () => {
      void loadEsimsRef.current();
    },
  });

  const applyAssignedSim = useCallback(
    (payload: EsimAssignmentPayload | undefined) => {
      if (payload) setAssignedSim(payload);
    },
    []
  );

  const handleExtendActivationDate = async () => {
    if (!extendDate || !promptOrderId) {
      setPromptError('Choose a valid eSIM activation date.');
      return;
    }
    setAssigningSim(true);
    setPromptError('');
    try {
      const res = await OrderApi.updateActivationDate({
        order_id: promptOrderId,
        activation_date: extendDate,
      });
      if (!res.ok) {
        setPromptError(apiErrorMessage(res.body, 'Could not update the eSIM activation date.'));
        return;
      }
      datePromptDismissedRef.current = true;
      setAssignPrompt(false);
      setExtendDate('');
      await loadOrders();
      await loadEsims();
    } catch (e: unknown) {
      setPromptError(e instanceof Error ? e.message : 'Could not update the eSIM activation date.');
    } finally {
      setAssigningSim(false);
    }
  };

  const dismissAssignPrompt = () => {
    datePromptDismissedRef.current = true;
    setAssignPrompt(false);
    setPromptError('');
  };

  const handleConfirmActivationDate = async () => {
    if (confirmationInFlightRef.current || assigningSim) return;
    confirmationInFlightRef.current = true;
    setAssigningSim(true);
    setPromptError('');
    setRechargeNotice('');
    let numberAssigned = false;
    try {
      const res = await EsimsApi.register();
      if (!res.ok) {
        throw new Error(apiErrorMessage(res.body, 'Could not set up your eSIM. Please try again.'));
      }
      const result = parseAssignmentStatus(res.body);
      if (!result.has_sim) {
        if (result.status === 'scheduled') {
          datePromptDismissedRef.current = true;
          setAssignPrompt(false);
          await loadOrders();
          await loadEsims();
          return;
        }
        const message = result.status === 'waiting_for_inventory'
          ? 'No eSIM numbers are available yet. Please try confirming again shortly.'
          : result.status === 'payment_required'
            ? 'Your payment has not been confirmed yet. Complete payment, then try again.'
            : apiErrorMessage(res.body, 'Your eSIM has not been assigned yet. Please try again.');
        setPromptError(message);
        return;
      }

      numberAssigned = true;
      applyAssignedSim(result.data);
      datePromptDismissedRef.current = true;
      setAssignPrompt(false);
      setWaitingForSim(false);
      setAssignmentLoading(false);
      localStorage.removeItem('pendingPayment');
      setPendingPayment(null);

      const body = res.body as { recharge?: { recharge_status?: string; failed?: number } } | null;
      const recharge = body?.recharge;
      if (recharge?.recharge_status !== 'success' || (recharge.failed ?? 0) > 0) {
        setRechargeNotice('Your number is assigned, but your data is not confirmed ready yet. You can retry data setup below.');
      }
      await loadOrders();
      await loadEsims();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not set up your eSIM. Please try again.';
      if (numberAssigned || !assignPrompt) setRechargeNotice(message);
      else setPromptError(message);
    } finally {
      confirmationInFlightRef.current = false;
      setAssigningSim(false);
    }
  };

  const handleRetryPayment = useCallback(async () => {
    setRetryPayError('');
    setRetryPaying(true);
    const paymentTab = window.open('about:blank', '_blank');
    if (paymentTab) paymentTab.opener = null;
    try {
      if (!paymentTab) throw new Error('Could not open the payment page. Allow pop-ups and try again.');
      const unpaidOrder = findLatestUnpaidOrder(orders);
      const pending = pendingPayment ?? readPendingPaymentFromStorage();

      const orderId = unpaidOrder?.id ?? pending?.order_id;
      if (orderId == null) {
        throw new Error('No unpaid order found. Start checkout again from bundles.');
      }

      const draftId = unpaidOrder?.draft_id ?? pending?.draft_id;
      const amount = unpaidOrder
        ? Number(unpaidOrder.total_amount)
        : Number(pending?.total ?? 0);
      const currency = unpaidOrder?.currency ?? pending?.currency ?? 'USD';
      const email =
        (typeof user?.email === 'string' ? user.email : '') ||
        pending?.email ||
        '';
      const country =
        unpaidOrder?.metadata?.country ?? pending?.country ?? 'TZ';
      const countryName =
        unpaidOrder?.metadata?.countryName ??
        unpaidOrder?.trip?.destination_country ??
        pending?.countryName ??
        pending?.trip?.countryName ??
        'Tanzania';
      const simType =
        unpaidOrder?.metadata?.simType ?? pending?.simType ?? 'esim';

      let paymentUrl = normalizePaymentUrl(checkoutUrlFromOrder(unpaidOrder)) ??
        (String(pending?.order_id) === String(orderId) ? normalizePaymentUrl(pending?.payment_url) : null);
      if (!paymentUrl) {
        const res = await OrderApi.evpayCheckoutUrl(orderId);
        if (res.ok) paymentUrl = normalizePaymentUrl(extractPaymentUrl(res.body));
      }
      const targetUrl = resolvePaymentTargetUrl(paymentUrl, {
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        email,
        country,
        countryName,
        simType,
        orderId,
        draftId,
      });

      // Keep pending snapshot so the dashboard can keep offering retry until paid.
      const snapshot = {
        order_id: orderId,
        draft_id: draftId,
        payment_url: targetUrl,
        items:
          pending?.items ??
          unpaidOrder?.order_items?.map((item) => ({
            bundle: {
              name: item.bundle_name,
              data_mb: item.data_amount ?? undefined,
              validity_days: item.validity_days,
              price: item.price,
              currency: item.currency,
            },
            quantity: 1,
          })),
        trip: pending?.trip ?? {
          countryName,
          arrivalDate: unpaidOrder?.trip?.arrival_date,
          departureDate: unpaidOrder?.trip?.departure_date,
          duration: unpaidOrder?.trip?.duration_days,
        },
        simType,
        country,
        countryName,
        total: Number.isFinite(amount) ? amount : pending?.total,
        currency,
        email,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem('pendingPayment', JSON.stringify(snapshot));
      setPendingPayment(snapshot);

      try {
        sessionStorage.setItem('travela:showReceiptPrompt', '1');
        sessionStorage.setItem('travela:receiptOrderId', String(orderId));
      } catch {
        /* ignore */
      }
      setShowReceiptPrompt(true);
      setReceiptOrderId(String(orderId));

      paymentTab.location.href = targetUrl;
    } catch (e: unknown) {
      paymentTab?.close();
      setRetryPayError(
        e instanceof Error ? e.message : 'Could not restart payment. Try again.'
      );
    } finally {
      setRetryPaying(false);
    }
  }, [orders, pendingPayment, user?.email]);

  useEffect(() => {
    if (!topUpModalOpen) return;

    let cancelled = false;
    setTopUpBundlesLoading(true);

    (async () => {
      try {
        const res = await BundlesApi.list<BundlesResponse>();
        const apiBundles = res.data?.bundles ?? [];
        const uiBundles: TopUpBundle[] = apiBundles.map((b) => {
            const dataMb = bundleToMb(b);
            return {
              id: b.id,
              sim_bundle_id: b.sim_bundle_id ?? null,
              name: displayBundleName(b.alias?.trim() || fallbackBundleName(dataMb) || b.name),
              data_mb: dataMb,
              validity_days: PLAN_VALIDITY_DAYS,
              price: b.price ?? b.price_usd ?? undefined,
              currency: b.currency ?? undefined,
              tagline: bundleTagline(b.validity_days, dataMb),
            };
          });
        if (!cancelled) setTopUpBundles(uiBundles);
      } catch {
        if (!cancelled) setTopUpBundles([]);
      } finally {
        if (!cancelled) setTopUpBundlesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [topUpModalOpen]);

  const closeTopUpModal = useCallback((onClosed?: () => void) => {
    if (topUpModalClosing) return;
    setTopUpModalClosing(true);
    window.setTimeout(() => {
      setTopUpModalOpen(false);
      setTopUpModalClosing(false);
      setTopUpModalShown(false);
      onClosed?.();
    }, TOPUP_MODAL_TRANSITION_MS);
  }, [topUpModalClosing]);

  useEffect(() => {
    if (!topUpModalOpen) return;
    setTopUpModalShown(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setTopUpModalShown(true));
    });
    return () => cancelAnimationFrame(id);
  }, [topUpModalOpen]);

  useEffect(() => {
    if (!topUpModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTopUpModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [topUpModalOpen, closeTopUpModal]);

  const handleTopUpPurchase = useCallback(
    (bundle: TopUpBundle) => {
      if (topUpModalClosing) return;

      const activeEsim = userEsims[0] ?? null;
      const msisdn =
        activeEsim?.esim?.msisdn?.trim() ||
        activeEsim?.esim?.phone_number?.trim() ||
        '';

      if (!activeEsim?.id || !msisdn) {
        window.alert('No SIM found on your account. Complete your first purchase first.');
        return;
      }

      const country = activeEsim?.order?.metadata?.country ?? 'TZ';
      const countryName =
        activeEsim?.order?.metadata?.countryName ??
        purchase?.trip?.countryName ??
        'Tanzania';
      const simType =
        activeEsim?.esim?.sim_type === 'physical' ? 'physical' : 'esim';

      const currentDataMb =
        dataMbFromAssignment(activeEsim) ?? 0;

      localStorage.setItem(
        'cart',
        JSON.stringify({
          bundle,
          country,
          countryName,
          simType,
          checkoutMode: 'topup',
          user_esim_id: activeEsim.id,
          msisdn,
          current_data_mb: currentDataMb,
        })
      );
      sessionStorage.setItem(CHECKOUT_TRANSITION_KEY, 'topup-modal');
      closeTopUpModal(() => router.push('/checkout'));
    },
    [userEsims, purchase, router, topUpModalClosing, closeTopUpModal]
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const dest = `/dashboard${search}`;
      router.replace(`/auth/login?redirect=${encodeURIComponent(dest)}`);
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const pending = readPendingPaymentFromStorage();
    const storedPurchase = readLastPurchaseFromStorage();
    setPendingPayment(pending);
    if (storedPurchase) {
      setPurchase(storedPurchase);
    } else if (pending) {
      setPurchase({
        items: pending.items,
        trip: pending.trip,
        total: pending.total,
        currency: pending.currency,
        orderId: pending.order_id,
        draftId: pending.draft_id,
        simType: pending.simType,
      });
    }
    try {
      if (sessionStorage.getItem('travela:showReceiptPrompt') === '1') {
        setShowReceiptPrompt(true);
        setReceiptOrderId(sessionStorage.getItem('travela:receiptOrderId'));
      }
    } catch {
      /* ignore */
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!showReceiptPrompt || !pendingPayment?.order_id) return;
    if (!receiptOrderId) setReceiptOrderId(String(pendingPayment.order_id));
  }, [showReceiptPrompt, pendingPayment, receiptOrderId]);

  const dismissReceiptPrompt = () => {
    setShowReceiptPrompt(false);
    try {
      sessionStorage.removeItem('travela:showReceiptPrompt');
      sessionStorage.removeItem('travela:receiptOrderId');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadOrders();
  }, [isAuthenticated, loadOrders]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const refreshEsims = () => void loadEsims();
    window.addEventListener('focus', refreshEsims);
    window.addEventListener('pageshow', refreshEsims);
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadEsims();
        void loadOrders();
      }
    }, 30_000);

    return () => {
      window.removeEventListener('focus', refreshEsims);
      window.removeEventListener('pageshow', refreshEsims);
      window.clearInterval(refreshTimer);
    };
  }, [isAuthenticated, loadEsims, loadOrders]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const signal: WatcherSignal = { cancelled: false };

    async function dashboardSimWatcher() {
      setAssignmentLoading(true);
      setWaitingForSim(false);

      try {
        while (!signal.cancelled) {
          const statusRes = await EsimsApi.assignmentStatus();
          if (signal.cancelled) return;

          if (!statusRes.ok) {
            if (statusRes.status === 401) {
              setAssignmentLoading(false);
              return;
            }
            const msg =
              statusRes.body &&
              typeof statusRes.body === 'object' &&
              typeof (statusRes.body as { message?: unknown }).message === 'string'
                ? String((statusRes.body as { message: string }).message)
                : `Could not check SIM assignment (HTTP ${statusRes.status}).`;
            setEsimsError(msg);
            setAssignmentLoading(false);
            return;
          }

          const status = parseAssignmentStatus(statusRes.body);
          const pendingPay = readPendingPaymentFromStorage();
          const pendingOrderPaid = Boolean(
            pendingPay?.order_id &&
              ordersRef.current.some(
                (o) => String(o.id) === String(pendingPay.order_id) && isPaidOrder(o)
              )
          );
          // pendingPayment alone means checkout started — not that money cleared.
          const justPaid = Boolean(getBalancePollContext() || pendingOrderPaid);
          const isPhysicalPurchase =
            pendingPay?.simType === 'physical' ||
            hasPhysicalSimPurchase(ordersRef.current, pendingPay, purchaseRef.current);

          if (isPhysicalPurchase && !status.has_sim) {
            setWaitingForSim(false);
            setAssignmentLoading(false);
            return;
          }

          if (status.status === 'payment_required' && !pendingOrderPaid) {
            setWaitingForSim(false);
            setAssignmentLoading(false);
            return;
          }

          if (status.status === 'awaiting_confirmation') {
            const activationIso = status.activation_date ?? null;
            setPromptActivationDate(activationIso);
            setPromptOrderId(status.order_id ?? null);
            if (activationIso) {
              setExtendDate(activationIso.slice(0, 10));
            }
            if (!datePromptDismissedRef.current) {
              setAssignPrompt(true);
            }
            setWaitingForSim(false);
            setAssignmentLoading(false);
            return;
          }

          datePromptDismissedRef.current = false;
          setAssignPrompt(false);

          if (status.status === 'scheduled' || status.status === 'activation_pending') {
            setWaitingForSim(status.status === 'activation_pending');
            setAssignmentLoading(false);
            return;
          }

          if (status.has_sim) {
            applyAssignedSim(status.data);
            setWaitingForSim(false);
            localStorage.removeItem('pendingPayment');
            setPendingPayment(null);
            if (justPaid) {
              const rechargeRes = await EsimsApi.register();
              if (signal.cancelled) return;
              if (rechargeRes.ok || rechargeRes.status === 201) {
                const assign = parseAssignmentStatus(rechargeRes.body);
                if (assign.has_sim) applyAssignedSim(assign.data);
              }
            }
            await loadEsims();
            await loadOrders();
            setAssignmentLoading(false);
            return;
          }

          if (shouldPollAssignment(status, justPaid)) {
            setWaitingForSim(true);
            setAssignmentLoading(false);
          } else {
            setWaitingForSim(false);
            await loadEsims();
            setAssignmentLoading(false);
            return;
          }

          if (status.status !== 'waiting_for_agent') {
            const assignRes = await EsimsApi.register();
            if (signal.cancelled) return;

            if (assignRes.ok || assignRes.status === 201) {
              const assign = parseAssignmentStatus(assignRes.body);
              if (assign.has_sim) {
                applyAssignedSim(assign.data);
                setWaitingForSim(false);
                localStorage.removeItem('pendingPayment');
                setPendingPayment(null);
                await loadEsims();
                await loadOrders();
                setAssignmentLoading(false);
                return;
              }
            }
          }

          if (justPaid || status.status === 'payment_required') {
            await loadOrders();
          }

          const delaySeconds =
            justPaid ||
            status.status === 'payment_required' ||
            status.status === 'waiting_for_inventory'
              ? Math.min(status.retry_after_seconds ?? 5, 5)
              : (status.retry_after_seconds ?? DEFAULT_RETRY_SECONDS);
          await sleep(delaySeconds * 1000, signal);
        }
      } catch (e: unknown) {
        if (signal.cancelled) return;
        const fallback =
          e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
        setEsimsError(fallback || 'Failed to check SIM assignment.');
        setAssignmentLoading(false);
      }
    }

    void dashboardSimWatcher();

    return () => {
      signal.cancelled = true;
      if (signal.timeoutId) window.clearTimeout(signal.timeoutId);
    };
  }, [isAuthenticated, applyAssignedSim, loadEsims, loadOrders]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f6f8f6' }}>
        <Loader2 size={28} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const primaryUserEsim = userEsims[0] ?? null;
  const primaryBundle = purchase?.items?.[0]?.bundle;
  const pendingBundle = pendingPayment?.items?.[0]?.bundle;
  const latestPaidOrder = orders
    .filter(isPaidOrder)
    .sort(
      (a, b) =>
        new Date(b.paid_at ?? b.created_at).getTime() -
        new Date(a.paid_at ?? a.created_at).getTime()
    )[0];
  const latestUnpaidOrder = findLatestUnpaidOrder(orders);
  const pendingOrderIsPaid = Boolean(
    pendingPayment?.order_id &&
      orders.some(
        (o) => String(o.id) === String(pendingPayment.order_id) && isPaidOrder(o)
      )
  );
  const pendingNeedsPayment = Boolean(
    pendingPayment &&
      !pendingOrderIsPaid &&
      (pendingPayment.order_id == null ||
        !orders.some(
          (o) => String(o.id) === String(pendingPayment.order_id) && isPaidOrder(o)
        ))
  );
  const incompletePaymentOrder = latestUnpaidOrder;
  const needsPaymentRetry = Boolean(incompletePaymentOrder || pendingNeedsPayment);
  const incompletePaymentLabel = unpaidStatusLabel(
    incompletePaymentOrder?.payment_status || incompletePaymentOrder?.status || 'pending'
  );
  const incompleteBundleName =
    displayBundleName(
      incompletePaymentOrder?.order_items?.[0]?.bundle_name ??
        pendingPayment?.items?.[0]?.bundle?.name ??
        purchase?.items?.[0]?.bundle?.name ??
        null
    ) || 'your plan';
  const incompleteAmount =
    incompletePaymentOrder?.total_amount != null
      ? Number(incompletePaymentOrder.total_amount)
      : pendingPayment?.total ?? purchase?.total ?? null;
  const incompleteCurrency =
    incompletePaymentOrder?.currency ??
    pendingPayment?.currency ??
    purchase?.currency ??
    'USD';
  const incompleteOrderId =
    incompletePaymentOrder?.id ?? pendingPayment?.order_id ?? purchase?.orderId ?? null;
  const apiBundle = primaryUserEsim?.bundle ?? latestOrderBundle ?? null;

  const assignedMsisdn =
    assignedSim?.esim?.msisdn ??
    assignedSim?.esim?.phone_number ??
    primaryUserEsim?.esim?.msisdn ??
    primaryUserEsim?.esim?.phone_number ??
    null;
  const assignedIccid =
    assignedSim?.esim?.iccid ?? primaryUserEsim?.esim?.iccid ?? null;
  const assignedQrCodeData =
    (typeof primaryUserEsim?.esim?.qr_code_data === 'string'
      ? primaryUserEsim.esim.qr_code_data.trim()
      : '') ||
    (typeof assignedSim?.esim?.qr_code_data === 'string'
      ? assignedSim.esim.qr_code_data.trim()
      : '') ||
    null;
  const hasActivationData =
    Boolean(assignedQrCodeData) ||
    primaryUserEsim?.esim?.has_activation_data === true ||
    assignedSim?.esim?.has_activation_data === true;
  const activationEmailSentAt =
    primaryUserEsim?.activation_email_sent_at ?? null;
  const assignedBundleName = displayBundleName(
    apiBundle?.alias ??
      fallbackBundleName(coerceNumber(apiBundle?.data_mb) ?? undefined) ??
      apiBundle?.type_name ??
      apiBundle?.type ??
      apiBundle?.name ??
      assignedSim?.bundle?.type_name ??
      assignedSim?.bundle?.name ??
      pendingBundle?.name ??
      primaryBundle?.name ??
      null
  ) || null;
  const assignedBundleDuration =
    apiBundle?.duration ??
    (apiBundle?.validity_days ? `${apiBundle.validity_days} days` : null) ??
    assignedSim?.bundle?.duration ??
    (pendingBundle?.validity_days ? `${pendingBundle.validity_days} days` : null) ??
    (primaryBundle?.validity_days ? `${primaryBundle.validity_days} days` : null);
  const planValidityLabel = assignedBundleDuration ?? '30 days';

  const carrierDataMb = dataMbFromAssignment(primaryUserEsim);
  const purchasedPlanMb =
    coerceNumber(pendingBundle?.data_mb) ??
    coerceNumber(primaryBundle?.data_mb) ??
    coerceNumber(latestPaidOrder?.order_items?.[0]?.data_amount) ??
    coerceNumber(apiBundle?.data_mb) ??
    null;
  const displayDataMb =
    confirmedDataMb ??
    carrierDataMb ??
    purchasedPlanMb;

  const balanceStatusSub = confirmedDataMb != null || carrierDataMb != null
    ? 'Live data remaining'
    : balancePolling || waitingForSim
      ? 'Confirming with the network'
      : purchasedPlanMb != null
        ? 'Purchased data'
        : 'Waiting for data balance';

  const simType = primaryUserEsim?.esim?.sim_type ?? assignedSim?.esim?.sim_type ?? purchase?.simType ?? pendingPayment?.simType ?? 'esim';
  const isEsimType = simType.toLowerCase() !== 'physical';
  const simStatus = primaryUserEsim?.esim?.status ?? assignedSim?.esim?.status ?? null;
  const simIsActive = isEsimType
    ? Boolean(primaryUserEsim?.device_activated_at)
    : isSimActive(simStatus);
  const hasActiveEsim =
    Boolean(assignedMsisdn) || userEsims.length > 0;
  const hasPurchasedPlan =
    hasActiveEsim ||
    Boolean(latestPaidOrder && latestPaidOrder.metadata?.simType !== 'physical');
  const simTypeTitle = simTypeLabel(simType);

  const physicalPickupDetails = resolvePhysicalPickupDetails(
    orders,
    pendingPayment,
    purchase
  );
  const isPhysicalSimAwaitingPickup =
    !hasActiveEsim && physicalPickupDetails != null;

  const matchedReceiptOrder =
    orders.find((o) => receiptOrderId && String(o.id) === String(receiptOrderId)) ??
    orders.find(
      (o) =>
        pendingPayment?.order_id != null && String(o.id) === String(pendingPayment.order_id)
    ) ??
    null;
  const receiptOrderPaid = matchedReceiptOrder ? isPaidOrder(matchedReceiptOrder) : false;
  const receiptBundleName =
    matchedReceiptOrder?.order_items?.[0]?.bundle_name ??
    pendingPayment?.items?.[0]?.bundle?.name ??
    purchase?.items?.[0]?.bundle?.name ??
    'your plan';
  const receiptAmount =
    matchedReceiptOrder?.total_amount != null
      ? Number(matchedReceiptOrder.total_amount)
      : pendingPayment?.total ?? purchase?.total ?? null;
  const receiptCurrency =
    matchedReceiptOrder?.currency ?? pendingPayment?.currency ?? purchase?.currency ?? 'USD';
  const receiptHref = matchedReceiptOrder
    ? `/receipts?orderId=${matchedReceiptOrder.id}`
    : receiptOrderId
      ? `/receipts?orderId=${receiptOrderId}`
      : '/receipts';

  const totalEsims =
    userEsims.length > 0
      ? userEsims.length
      : (purchase?.items?.reduce((s, c) => s + c.quantity, 0) ?? 0);

  const headlineData = displayDataBalance(displayDataMb);
  const balanceAreaValue = displayDataBalance(displayDataMb);

  const esimTitle =
    assignedBundleName ??
    displayBundleName(pendingBundle?.name ?? primaryBundle?.name ?? latestPaidOrder?.order_items?.[0]?.bundle_name ?? null) ??
    (assignedMsisdn ? formatMsisdn(assignedMsisdn) : null) ??
    'eSIM';

  const planValidityDays = PLAN_VALIDITY_DAYS;
  const scheduledActivationIso =
    latestPaidOrder?.trip?.arrival_date ?? purchase?.trip?.arrivalDate ?? null;
  const planStartIso = primaryUserEsim?.plan_started_at ?? null;
  const confirmedExpiryIso = primaryUserEsim?.plan_expires_at ?? null;
  const deactivationIso = confirmedExpiryIso ??
    (scheduledActivationIso ? plannedExpiryDate(scheduledActivationIso.slice(0, 10)) : null);
  const daysRemaining = confirmedExpiryIso ? daysUntil(confirmedExpiryIso) : null;
  const daysRemainingLabel = daysLeftLabel(daysRemaining);

  const todayPart = activationToday();
  const activationDay = toDatePart(scheduledActivationIso);
  /** Plan window ended — user cannot use this SIM anymore. */
  const isPlanExpired = hasPlanExpired(confirmedExpiryIso);
  /**
   * Purchased with a future activation date — number/activation details stay hidden
   * until that day; only purchase confirmation + receipt for now.
   */
  const isReservedFuture = Boolean(
    hasPurchasedPlan &&
      !planStartIso &&
      !isPlanExpired &&
      activationDay &&
      todayPart &&
      activationDay > todayPart
  );
  const daysUntilActivation = isReservedFuture ? daysUntil(scheduledActivationIso) : null;
  const activationCountdownLabel =
    daysUntilActivation == null
      ? null
      : daysUntilActivation <= 0
        ? 'today'
        : daysUntilActivation === 1
          ? 'tomorrow'
          : `in ${daysUntilActivation} days`;

  const planLifecycleLabel = isPlanExpired
    ? 'Expired'
    : isReservedFuture
      ? 'Scheduled'
      : !hasActiveEsim && hasPurchasedPlan
        ? 'Setting up'
        : isEsimType && hasActiveEsim && !planStartIso
          ? 'Preparing data'
        : isEsimType
          ? esimDeviceStatusLabel(primaryUserEsim, simStatus)
          : simStatusLabel(simStatus);
  const simStatusDisplay = planLifecycleLabel;

  const purchasedDataMb = orders
    .filter(isPaidOrder)
    .flatMap((o) => o.order_items ?? [])
    .reduce((sum, item) => sum + (coerceNumber(item.data_amount) ?? 0), 0);
  const bundleTotalMb =
    purchasedDataMb ||
    coerceNumber(apiBundle?.data_mb) ||
    coerceNumber(primaryUserEsim?.order_item?.data_amount) ||
    coerceNumber(latestPaidOrder?.order_items?.[0]?.data_amount) ||
    coerceNumber(primaryBundle?.data_mb);
  const remainingMb = displayDataMb;
  const dataRemainingLabel =
    remainingMb != null
      ? displayDataBalance(remainingMb)
      : balancePolling
        ? 'Loading…'
        : !simIsActive
          ? 'Not started'
          : '—';
  const dataProgressPct =
    remainingMb == null || !bundleTotalMb
      ? simIsActive
        ? 0
        : 8
      : remainingMb <= 0
        ? 0
        : Math.min(100, Math.max(4, Math.round((remainingMb / bundleTotalMb) * 100)));

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f6f8f6' }}>
      {assignPrompt && !isPlanExpired && (
        <AssignSimPrompt
          activationDateLabel={formatTripDate(promptActivationDate)}
          currentActivationIso={promptActivationDate ? promptActivationDate.slice(0, 10) : null}
          saving={assigningSim}
          error={promptError}
          extendDate={extendDate}
          minExtendDate={addDaysToIso(activationToday(), 1)}
          onExtendDateChange={setExtendDate}
          onSaveDate={() => void handleExtendActivationDate()}
          onConfirm={() => void handleConfirmActivationDate()}
          onClose={dismissAssignPrompt}
        />
      )}
      {/* Header bar */}
      <div className="bg-white border-b border-slate-100 px-4 py-4 sm:py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-0.5">
              Dashboard
            </p>
            <h1 className="text-base sm:text-xl font-extrabold text-slate-900 truncate">
              {isAuthenticated
                ? `Welcome back, ${user?.name?.split(' ')[0] ?? 'Traveller'}`
                : 'Your eSIM Dashboard'}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setTopUpModalOpen(true)}
            className="flex-shrink-0 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#112116' }}
          >
            Top Up
          </button>
        </div>
      </div>

      {balancePolling ? (
        <div className="bg-emerald-50 border-b border-emerald-100 px-4 py-3">
          <p className="max-w-5xl mx-auto text-sm text-emerald-800 flex items-center gap-2">
            <Loader2 size={16} className="shrink-0 animate-spin" />
            Balance is confirming with the network. Your purchased plan is shown below.
          </p>
        </div>
      ) : null}

      {topUpModalOpen && (
        <div
          className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 transition-opacity duration-300 ease-out ${
            topUpModalShown && !topUpModalClosing ? 'opacity-100' : 'opacity-0'
          } ${topUpModalClosing ? 'pointer-events-none' : ''}`}
          onClick={() => closeTopUpModal()}
          role="presentation"
        >
          <div
            className={`bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              topUpModalShown && !topUpModalClosing
                ? 'opacity-100 translate-y-0 sm:scale-100'
                : 'opacity-0 translate-y-full sm:translate-y-4 sm:scale-95'
            }`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="topup-modal-title"
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b border-slate-100"
              style={{ backgroundColor: '#112116' }}
            >
              <div>
                <h2 id="topup-modal-title" className="text-base font-extrabold text-white">
                  Top Up
                </h2>
                <p className="text-xs text-white/60 mt-0.5">Choose a bundle to purchase</p>
              </div>
              <button
                type="button"
                onClick={() => closeTopUpModal()}
                disabled={topUpModalClosing}
                className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-3 max-h-[calc(85vh-4.5rem)]">
              {topUpBundlesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={28} className="animate-spin text-slate-400" />
                </div>
              ) : topUpBundles.length === 0 ? (
                <div className="text-center py-12">
                  <Package size={36} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-sm text-slate-500 font-medium">No bundles available right now.</p>
                </div>
              ) : (
                topUpBundles.map((bundle) => (
                  <div
                    key={bundle.id}
                    className="rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900">{bundle.name}</p>
                      <p className="text-lg font-black text-slate-900 tracking-tight">
                        {formatMb(bundle.data_mb)}
                      </p>
                      {bundle.tagline && bundle.tagline !== bundle.name && (
                        <p className="text-xs text-slate-500">{bundle.tagline}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-1">
                        {PLAN_VALIDITY_DAYS} days · {bundle.currency ?? 'USD'}{' '}
                        {Number(bundle.price ?? 0).toFixed(2)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTopUpPurchase(bundle)}
                      disabled={topUpModalClosing}
                      className="flex-shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-60"
                      style={{ backgroundColor: '#112116' }}
                    >
                      Purchase
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {rechargeNotice && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p>{rechargeNotice}</p>
            <button
              type="button"
              onClick={() => void handleConfirmActivationDate()}
              disabled={assigningSim}
              className="mt-2 font-bold underline disabled:opacity-60"
            >
              {assigningSim ? 'Setting up data…' : 'Retry data setup'}
            </button>
          </div>
        )}
        {esimsError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {esimsError}
          </div>
        )}

        {needsPaymentRetry && (
          <div className="rounded-2xl border border-amber-200 bg-white overflow-hidden shadow-sm">
            <div
              className="px-5 py-4 flex items-start justify-between gap-3"
              style={{ backgroundColor: 'rgba(245,158,11,0.12)' }}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#112116', color: 'white' }}
                >
                  <CreditCard size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-900">{incompletePaymentLabel}</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Your order was started but payment is not complete yet. Pay again for this order
                    — once it clears, your number will appear here automatically.
                  </p>
                </div>
              </div>
              <span
                className="text-[11px] font-extrabold px-2.5 py-1 rounded-full flex-shrink-0"
                style={{ backgroundColor: 'rgba(146,64,14,0.12)', color: '#92400e' }}
              >
                Unpaid
              </span>
            </div>
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Order</p>
                <p className="text-sm font-extrabold text-slate-900 truncate">{incompleteBundleName}</p>
                {incompleteAmount != null && (
                  <p className="text-sm font-bold mt-0.5" style={{ color: '#112116' }}>
                    {incompleteCurrency} {Number(incompleteAmount).toFixed(2)}
                  </p>
                )}
                {incompleteOrderId != null && (
                  <p className="text-xs text-slate-400 mt-1">Order #{incompleteOrderId}</p>
                )}
                {retryPayError && (
                  <p className="text-xs font-medium text-red-600 mt-2">{retryPayError}</p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => void handleRetryPayment()}
                  disabled={retryPaying}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                  style={{ backgroundColor: '#112116' }}
                >
                  {retryPaying ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Opening payment…
                    </>
                  ) : (
                    <>
                      <CreditCard size={16} /> Complete payment
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void loadOrders()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Refresh status
                </button>
              </div>
            </div>
          </div>
        )}

        {showReceiptPrompt && !needsPaymentRetry && (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div
              className="px-5 py-4 flex items-start justify-between gap-3"
              style={{ backgroundColor: 'rgba(23,207,84,0.1)' }}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#112116', color: 'white' }}
                >
                  <Receipt size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-900">
                    {receiptOrderPaid ? 'Payment received' : 'After you finish payment'}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    {receiptOrderPaid
                      ? 'Download your Travela receipt with plan and payment details.'
                      : 'Complete payment in the other tab, then come back here. You can download your Travela receipt once payment is confirmed.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissReceiptPrompt}
                className="p-1.5 rounded-full text-slate-400 hover:bg-white/70 hover:text-slate-700 flex-shrink-0"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Purchase</p>
                <p className="text-sm font-extrabold text-slate-900 truncate">{receiptBundleName}</p>
                {receiptAmount != null && (
                  <p className="text-sm font-bold mt-0.5" style={{ color: '#112116' }}>
                    {receiptCurrency} {Number(receiptAmount).toFixed(2)}
                  </p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Link
                  href={receiptHref}
                  onClick={dismissReceiptPrompt}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90"
                  style={{ backgroundColor: '#112116' }}
                >
                  <Download size={16} />
                  {receiptOrderPaid ? 'Download receipt' : 'View receipts'}
                </Link>
                <button
                  type="button"
                  onClick={() => void loadOrders()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Refresh status
                </button>
              </div>
            </div>
          </div>
        )}

        {(waitingForSim || (isEsimType && hasActiveEsim && !planStartIso)) && !isPhysicalSimAwaitingPickup && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 flex items-start gap-3">
            <Loader2 size={20} className="animate-spin text-sky-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-sky-900">
                Payment received. We&apos;re setting up your eSIM.
              </p>
              <p className="text-xs text-sky-700 mt-1">
                Assignment and data setup run automatically. Your installation QR will appear when data is ready.
              </p>
            </div>
          </div>
        )}

        {isPhysicalSimAwaitingPickup && physicalPickupDetails && (
          <div className="rounded-2xl border border-emerald-200 bg-white overflow-hidden shadow-sm">
            <div
              className="px-6 py-5 flex items-start gap-4"
              style={{ backgroundColor: 'rgba(23,207,84,0.08)' }}
            >
              <div
                className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center"
                style={{ backgroundColor: 'rgba(23,207,84,0.15)' }}
              >
                <MapPin size={22} style={{ color: '#112116' }} />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 mb-1">
                  Your number is reserved — pick up your SIM at the airport
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Good news — your Travela number has already been purchased and is waiting for you.
                  When you arrive, visit the Travela counter at the airport to collect your physical
                  SIM card. Bring a valid ID and your order reference below so our team can help you
                  quickly.
                </p>
              </div>
            </div>

            <div className="px-6 py-5 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-4">
                <Package size={16} style={{ color: '#17cf54' }} />
                <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                  Order details
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 mb-4">
                {physicalPickupDetails.draftId && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 sm:col-span-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
                      Order reference (show at counter)
                    </p>
                    <p className="text-lg font-black text-slate-900 tracking-tight break-all">
                      {physicalPickupDetails.draftId}
                    </p>
                  </div>
                )}
                {physicalPickupDetails.orderId != null && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
                      Order ID
                    </p>
                    <p className="text-sm font-bold text-slate-900">{physicalPickupDetails.orderId}</p>
                  </div>
                )}
                {physicalPickupDetails.countryName && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
                      Destination
                    </p>
                    <p className="text-sm font-bold text-slate-900">{physicalPickupDetails.countryName}</p>
                  </div>
                )}
                {formatTripDate(physicalPickupDetails.deactivationDate) && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
                      Deactivation date
                    </p>
                    <p className="text-sm font-bold text-slate-900">
                      {formatTripDate(physicalPickupDetails.deactivationDate)}
                    </p>
                  </div>
                )}
                {physicalPickupDetails.paymentReference && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 sm:col-span-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
                      Payment reference
                    </p>
                    <p className="text-sm font-bold text-slate-900 break-all">
                      {physicalPickupDetails.paymentReference}
                    </p>
                  </div>
                )}
              </div>

              {physicalPickupDetails.items.length > 0 && (
                <div className="space-y-2 mb-4">
                  {physicalPickupDetails.items.map((item, index) => (
                    <div
                      key={`${item.name}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900">
                          {item.dataLabel} · {item.name}
                        </p>
                        {item.validityDays != null && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.validityDays} days validity · Physical SIM
                          </p>
                        )}
                      </div>
                      {item.price != null && (
                        <p className="text-sm font-semibold text-slate-800 flex-shrink-0">
                          {item.currency ?? physicalPickupDetails.currency}{' '}
                          {item.price}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {physicalPickupDetails.total != null && physicalPickupDetails.currency && (
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <p className="text-sm font-bold text-slate-700">Total paid</p>
                  <p className="text-base font-extrabold" style={{ color: '#112116' }}>
                    {physicalPickupDetails.currency} {physicalPickupDetails.total}
                  </p>
                </div>
              )}

              {ordersLoading && (
                <p className="text-xs text-slate-400 mt-3 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Refreshing order details…
                </p>
              )}
            </div>
          </div>
        )}

        {assignmentLoading && !hasActiveEsim && !waitingForSim && !hasPurchasedPlan && !isPhysicalSimAwaitingPickup && !needsPaymentRetry ? (
          <div className="rounded-2xl p-12 flex items-center justify-center bg-white border border-slate-100">
            <Loader2 size={28} className="animate-spin text-slate-400" />
          </div>
        ) : hasActiveEsim || hasPurchasedPlan ? (
          <>
            {/* Future activation — reserved: receipt only, no number / activate details yet */}
            {isReservedFuture ? (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <div
                    className="px-5 py-4 flex items-start justify-between gap-3"
                    style={{ backgroundColor: 'rgba(17,33,22,0.06)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                        Your purchase
                      </p>
                      <h2 className="text-lg font-extrabold text-slate-900">eSIM scheduled</h2>
                      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                        Your plan is set to activate on{' '}
                        <span className="font-extrabold text-slate-900">
                          {formatTripDate(scheduledActivationIso)}
                        </span>
                        {activationCountdownLabel ? (
                          <>
                            {' '}
                            (
                            <span className="font-semibold text-slate-800">
                              {activationCountdownLabel}
                            </span>
                            )
                          </>
                        ) : null}
                        . At 00:01 Tanzania time that day, we will assign your number and load your data automatically, then email your installation QR.
                      </p>
                    </div>
                    <span
                      className="text-xs font-extrabold px-3 py-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: 'rgba(17,33,22,0.12)', color: '#112116' }}
                    >
                      Scheduled
                    </span>
                  </div>

                  <div className="px-5 py-4 border-t border-slate-100">
                    <div className="min-w-0 mb-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Plan</p>
                      <p className="text-sm font-extrabold text-slate-900 truncate">{esimTitle}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {planValidityDays}-day plan · activates{' '}
                        {formatTripDate(scheduledActivationIso)}
                      </p>
                    </div>

                    <div
                      className="rounded-xl px-4 py-4"
                      style={{ backgroundColor: 'rgba(17,33,22,0.04)' }}
                    >
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-1.5">
                        <Clock size={13} />
                        What happens next
                      </p>
                      <ol className="space-y-3">
                        <li className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                          <span
                            className="flex-shrink-0 w-6 h-6 rounded-full text-[11px] font-extrabold flex items-center justify-center text-white"
                            style={{ backgroundColor: '#112116' }}
                          >
                            1
                          </span>
                          <span>
                            <span className="font-semibold text-slate-900">Until activation day</span>
                            {' — '}
                            nothing to install yet. Keep this account signed in and watch for our
                            email with your QR code and setup steps.
                          </span>
                        </li>
                        <li className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                          <span
                            className="flex-shrink-0 w-6 h-6 rounded-full text-[11px] font-extrabold flex items-center justify-center text-white"
                            style={{ backgroundColor: '#112116' }}
                          >
                            2
                          </span>
                          <span>
                            <span className="font-semibold text-slate-900">
                              On {formatTripDate(scheduledActivationIso)}
                            </span>
                            {' — '}
                            open this dashboard. Your Travela number and install instructions
                            (Activate eSIM / QR) will appear here so you can set up on your phone.
                          </span>
                        </li>
                        <li className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                          <span
                            className="flex-shrink-0 w-6 h-6 rounded-full text-[11px] font-extrabold flex items-center justify-center text-white"
                            style={{ backgroundColor: '#112116' }}
                          >
                            3
                          </span>
                          <span>
                            <span className="font-semibold text-slate-900">After install</span>
                            {' — '}
                            turn on the eSIM line and enable{' '}
                            <span className="font-semibold">Data Roaming</span>. Your{' '}
                            {planValidityDays}-day data plan starts from successful recharge.
                          </span>
                        </li>
                      </ol>
                    </div>

                    <Link
                      href={receiptHref}
                      className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90"
                      style={{ backgroundColor: '#112116' }}
                    >
                      <Download size={16} />
                      View purchase receipt
                    </Link>
                  </div>
                </div>
              </div>
            ) : isPlanExpired ? (
              /* Expired — clear, non-usable state */
              <div className="space-y-4">
                <div className="sim-card-shape p-4 sm:p-6 pt-7 sm:pt-8 text-white opacity-95">
                  <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="sim-chip mt-5 opacity-60" aria-hidden>
                        <span /><span /><span /><span /><span /><span />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {isEsimType ? (
                            <Wifi size={14} className="text-white/40" />
                          ) : (
                            <Smartphone size={14} className="text-white/40" />
                          )}
                          <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                            {simTypeTitle}
                          </p>
                        </div>
                        {assignedMsisdn && (
                          <h2 className="text-2xl sm:text-3xl font-black tracking-tight break-all leading-tight text-white/80">
                            {formatMsisdn(assignedMsisdn)}
                          </h2>
                        )}
                        <p className="text-base font-black text-white/80 mt-1">{esimTitle}</p>
                        <p className="text-sm font-semibold mt-2 text-white/55">
                          This plan has ended and can no longer be used.
                        </p>
                        {formatTripDate(deactivationIso) && (
                          <p className="text-xs font-semibold mt-2 text-white/45">
                            Ended {formatTripDate(deactivationIso)}
                          </p>
                        )}
                      </div>
                    </div>
                    <span
                      className="text-xs font-extrabold px-3 py-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: 'rgba(248,113,113,0.25)', color: '#fecaca' }}
                    >
                      Expired
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <p className="text-sm font-extrabold text-slate-900">Need data again?</p>
                    <p className="text-sm text-slate-500 mt-1">
                      Top up or buy a new plan to stay connected.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Link
                      href={receiptHref}
                      className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      <Receipt size={16} />
                      Receipt
                    </Link>
                    <button
                      type="button"
                      onClick={() => setTopUpModalOpen(true)}
                      className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90"
                      style={{ backgroundColor: '#112116' }}
                    >
                      Top Up
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
            {/* Activation instructions — shown first so users know what the buttons below do */}
            {isEsimType && hasActiveEsim && planStartIso && !primaryUserEsim?.device_activated_at && (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Info size={18} style={{ color: '#17cf54' }} />
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                    How to Install &amp; Activate Your eSIM
                  </h3>
                </div>
                <p className="mb-4 text-sm font-semibold text-slate-700">
                  Your eSIM number is already assigned and your data is ready. All you need to do is install your eSIM using the QR code or installation button below.
                </p>
                {[
                  {
                    num: '1',
                    text: (
                      <>
                        On the phone you want to use for data, tap{' '}
                        <strong className="text-slate-900">Activate eSIM</strong> below. On a different device
                        (like a computer), tap <strong className="text-slate-900">Open QR Code</strong> instead
                        and scan it with the phone you want to install the eSIM on.
                      </>
                    ),
                  },
                  {
                    num: '2',
                    text: 'Follow the prompts on your device to install the eSIM.',
                  },
                  {
                    num: '3',
                    text: (
                      <>
                        After a successful installation, make sure to turn on the eSIM and that{' '}
                        <strong className="text-slate-900">Data Roaming</strong> is enabled on your new eSIM.
                      </>
                    ),
                  },
                  { num: '4', text: 'Enjoy your trip!' },
                ].map((step) => (
                  <div key={step.num} className="flex gap-3 mb-3 last:mb-0">
                    <div
                      className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: 'rgba(23,207,84,0.15)', color: '#112116' }}
                    >
                      {step.num}
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{step.text}</p>
                  </div>
                ))}
              </div>
            )}

            {/* SIM card */}
            <div className="sim-card-shape p-4 sm:p-6 pt-7 sm:pt-8 text-white">
              <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="sim-chip mt-5" aria-hidden>
                    <span /><span /><span /><span /><span /><span />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {isEsimType ? (
                        <Wifi size={14} className="text-white/50" />
                      ) : (
                        <Smartphone size={14} className="text-white/50" />
                      )}
                      <p className="text-xs font-bold uppercase tracking-widest text-white/50">
                        {simTypeTitle}
                      </p>
                    </div>
                    {assignedMsisdn && (
                      <h2 className="text-2xl sm:text-4xl font-black tracking-tight break-all leading-tight">
                        {formatMsisdn(assignedMsisdn)}
                      </h2>
                    )}
                    {!assignedMsisdn && (
                      <h2 className="text-3xl sm:text-4xl font-black tracking-tight">{headlineData}</h2>
                    )}
                    {assignedIccid && (
                      <p className="text-xs font-semibold text-white/55 mt-2 tracking-wide break-all">
                        ICCID {assignedIccid}
                      </p>
                    )}
                    <p className="text-base font-black text-white mt-1">{esimTitle}</p>
                    <p className="text-sm font-semibold mt-1" style={{ color: '#17cf54' }}>
                      Valid for {planValidityDays} days
                    </p>
                    {purchase?.trip?.countryName && (
                      <p className="text-sm font-semibold mt-2 text-white/80">{purchase.trip.countryName}</p>
                    )}
                  </div>
                </div>
                <span
                  className="text-xs font-extrabold px-3 py-1.5 rounded-full flex-shrink-0"
                  style={
                    simIsActive
                      ? { backgroundColor: '#17cf54', color: '#112116' }
                      : { backgroundColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }
                  }
                >
                  {simStatusDisplay}
                </span>
              </div>

              {planStartIso && confirmedExpiryIso && (
                <div className="flex items-end justify-between gap-6 mb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                      From
                    </p>
                    <p className="text-sm font-bold mt-1 text-white rounded-lg px-2.5 py-1 bg-white/10 inline-block">
                      {formatTripDate(planStartIso) ?? '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                      To
                    </p>
                    <p className="text-sm font-bold mt-1 text-white rounded-lg px-2.5 py-1 bg-white/10 inline-block">
                      {formatTripDate(deactivationIso) ?? '—'}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-1">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                    Data remaining
                  </p>
                  <p className="text-xs font-bold text-white">
                    {dataRemainingLabel}
                  </p>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={dataProgressPct}
                  aria-label="Data remaining"
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${dataProgressPct}%`,
                      backgroundColor:
                        !simIsActive
                          ? 'rgba(255,255,255,0.35)'
                          : dataProgressPct <= 15
                            ? '#f59e0b'
                            : '#17cf54',
                    }}
                  />
                </div>
              </div>

              {isEsimType && primaryUserEsim?.id && planStartIso && (
                <div
                  className={
                    !primaryUserEsim.device_activated_at && hasActivationData
                      ? 'mt-5 grid grid-cols-1 gap-3'
                      : 'mt-5'
                  }
                >
                  <ActivateEsimButton
                    userEsimId={primaryUserEsim.id}
                    qrCodeData={assignedQrCodeData}
                    deviceActivatedAt={primaryUserEsim.device_activated_at}
                    msisdn={assignedMsisdn}
                    variant="dark"
                    onActivated={(activatedAt) => {
                      setUserEsims((prev) =>
                        prev.map((row) =>
                          row.id === primaryUserEsim.id
                            ? { ...row, device_activated_at: activatedAt }
                            : row
                        )
                      );
                    }}
                    onShowQr={() => setShowQrCode(true)}
                  />

                  {!primaryUserEsim.device_activated_at && hasActivationData && Boolean(planStartIso) && (
                    <button
                      type="button"
                      onClick={() => setShowQrCode((v) => !v)}
                      className="flex w-full items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold border border-white/25 text-white hover:bg-white/10 transition-colors"
                    >
                      {showQrCode ? 'Hide QR Code' : 'Open QR Code'}
                    </button>
                  )}
                </div>
              )}

              {isEsimType &&
                primaryUserEsim?.id &&
                !primaryUserEsim.device_activated_at &&
                hasActivationData && Boolean(planStartIso) &&
                showQrCode && (
                  <div>
                    <QrCodePanel
                      userEsimId={primaryUserEsim.id}
                      qrCodeData={assignedQrCodeData}
                      msisdn={assignedMsisdn}
                      iccid={assignedIccid}
                    />
                  </div>
                )}

              {isEsimType &&
                !primaryUserEsim?.device_activated_at &&
                hasActivationData && Boolean(planStartIso) &&
                user?.email && (
                  <p className="mt-4 text-sm text-white/70 leading-relaxed text-center px-1">
                    {activationEmailSentAt ? (
                      <>
                        We sent activation details to{' '}
                        <span className="font-semibold text-white">{user.email}</span>.
                        Open your QR code above when you&apos;re ready to install.
                      </>
                    ) : (
                      <>
                        We&apos;ll email activation details to{' '}
                        <span className="font-semibold text-white">{user.email}</span>{' '}
                        shortly. Use <strong className="text-white">Open QR Code</strong> or{' '}
                        <strong className="text-white">Activate eSIM</strong> above when ready.
                      </>
                    )}
                  </p>
                )}

              {totalEsims > 1 && (
                <div
                  className="mt-4 flex items-center gap-2 text-sm"
                  style={{ color: 'rgba(255,255,255,0.6)' }}
                >
                  <Globe size={14} />
                  <span>You have {totalEsims} eSIMs on your account</span>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              {[
                {
                  icon: isEsimType ? (
                    <Wifi size={16} style={{ color: '#17cf54' }} />
                  ) : (
                    <Smartphone size={16} style={{ color: '#17cf54' }} />
                  ),
                  label: 'SIM Type',
                  value: simTypeTitle,
                  sub: simStatusDisplay,
                },
                {
                  icon: <Globe size={16} style={{ color: '#17cf54' }} />,
                  label: 'Balance',
                  value: balanceAreaValue,
                  sub: balanceStatusSub,
                },
                {
                  icon: <Clock size={16} style={{ color: '#17cf54' }} />,
                  label: 'Duration',
                  value: confirmedExpiryIso
                    ? (daysRemainingLabel ?? planValidityLabel)
                    : `Valid for ${planValidityDays} days`,
                  sub: confirmedExpiryIso
                    ? formatTripDate(deactivationIso)
                      ? `Valid for ${planValidityDays} days · Expires ${formatTripDate(confirmedExpiryIso)}`
                      : `Valid for ${planValidityDays} days`
                    : formatTripDate(scheduledActivationIso)
                      ? `Activates ${formatTripDate(scheduledActivationIso)}`
                      : `${planValidityDays}-day plan`,
                },
              ].map((s, i, arr) => (
                <div
                  key={s.label}
                  className={`bg-white rounded-xl border border-slate-100 p-4${i === arr.length - 1 && arr.length % 2 !== 0 ? ' col-span-2 sm:col-span-1' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                    {s.icon} {s.label}
                  </div>
                  <p className="text-lg sm:text-xl font-extrabold text-slate-900">{s.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Activation instructions (physical SIM — eSIM instructions are shown above the SIM card) */}
            {!isEsimType && (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Info size={18} style={{ color: '#17cf54' }} />
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                    Physical SIM
                  </h3>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {simIsActive ? (
                    <>
                      Your physical SIM is in use. The plan is valid for {planValidityDays} days
                      {formatTripDate(planStartIso) ? ` from ${formatTripDate(planStartIso)}` : ''}
                      {formatTripDate(deactivationIso)
                        ? ` and deactivates on ${formatTripDate(deactivationIso)}.`
                        : '.'}
                    </>
                  ) : (
                    <>
                      Insert your physical SIM card into your device. Your plan will activate once the SIM is
                      registered on the network and is valid for {planValidityDays} days.
                    </>
                  )}
                </p>
              </div>
            )}
              </>
            )}
          </>
        ) : isPhysicalSimAwaitingPickup || needsPaymentRetry ? null : (
          /* Empty state */
          <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
            <div
              className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4 border border-slate-100"
              style={{ backgroundColor: '#f6f8f6' }}
            >
              <Smartphone size={30} className="text-slate-300" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 mb-2">No Active eSIM</h2>
            <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
              Purchase an eSIM bundle to stay connected during your travels.
            </p>
          </div>
        )}

        {/* Travela branding footer */}
        <div
          className="rounded-2xl p-6 text-center"
          style={{ backgroundColor: '#112116' }}
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            <CheckCircle size={16} style={{ color: '#17cf54' }} />
            <span className="text-xs font-bold text-white/70">
              Travela · by Onnela · For A More Enjoyable Life
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
