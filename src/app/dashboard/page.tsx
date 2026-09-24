'use client';

import ActivateEsimButton from '@/components/esim/ActivateEsimButton';
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
import { getOptimisticDataMb } from '@/lib/balance-poll';
import { displayBundleName, isHiddenCatalogBundle } from '@/lib/bundles';
import { dataMbFromAssignment } from '@/lib/esim-balance';
import { useBalancePoll } from '@/hooks/useBalancePoll';
import {
  CheckCircle,
  Clock,
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
  simType?: string;
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
  metadata?: {
    countryName?: string;
    simType?: string;
    country?: string;
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
  data_mb?: number | null;
  validity_days?: number | null;
  duration_days?: number | null;
  duration?: string | null;
}

interface EsimsListResponse {
  esims: UserEsimRecord[];
  latestOrderBundle: BundleDetail | null;
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

function resolveBundleDataMb(
  userBundle?: BundleDetail | null,
  latestOrderBundle?: BundleDetail | null,
  assignedBundle?: EsimAssignmentPayload['bundle'],
  purchaseBundle?: { data_mb?: number },
  orderItemDataAmount?: number | null
): number | undefined {
  const fromUser = coerceNumber(userBundle?.data_mb);
  if (fromUser != null && fromUser > 0) return fromUser;

  const fromLatestOrder = coerceNumber(latestOrderBundle?.data_mb);
  if (fromLatestOrder != null && fromLatestOrder > 0) return fromLatestOrder;

  const fromAssigned = coerceNumber(assignedBundle?.data_mb);
  if (fromAssigned != null && fromAssigned > 0) return fromAssigned;

  const fromPurchase = coerceNumber(purchaseBundle?.data_mb);
  if (fromPurchase != null && fromPurchase > 0) return fromPurchase;

  const fromOrderItem = coerceNumber(orderItemDataAmount);
  if (fromOrderItem != null && fromOrderItem > 0) return fromOrderItem;

  return undefined;
}

/** Balance area shows bundle data allowance (data_mb) first. */
function displayDataBalance(bundleDataMb?: number) {
  if (bundleDataMb != null && bundleDataMb > 0) return formatMb(bundleDataMb);
  return '—';
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
    return { esims: [], latestOrderBundle: null };
  }

  const b = body as { data?: unknown; latest_order?: unknown };
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

  return { esims, latestOrderBundle };
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
  const retry_after_seconds =
    typeof source.retry_after_seconds === 'number'
      ? source.retry_after_seconds
      : undefined;

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

  return { has_sim, status, retry_after_seconds, inventory, data };
}

function shouldPollAssignment(status: EsimAssignmentStatus): boolean {
  if (status.has_sim) return false;
  return status.status === 'waiting_for_inventory';
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

function formatOrderItemData(mb?: number | null) {
  if (mb == null || mb <= 0) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

function resolvePhysicalPickupDetails(
  orders: OrderRecord[],
  pendingPayment: PendingPaymentData | null,
  purchase: PurchaseData | null
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

  const localSource = pendingPayment?.simType === 'physical' ? pendingPayment : null;
  const purchaseSource =
    !localSource && purchase?.simType === 'physical' ? purchase : null;
  const source = localSource ?? purchaseSource;
  if (!source) return null;

  const items =
    source.items?.map((item) => ({
      name: item.bundle.name,
      dataLabel: formatOrderItemData(item.bundle.data_mb),
      validityDays: item.bundle.validity_days,
      price:
        item.bundle.price != null
          ? Number(item.bundle.price).toFixed(2)
          : undefined,
      currency: item.bundle.currency ?? source.currency,
    })) ?? [];

  const validityDays = items[0]?.validityDays ?? 30;
  return {
    draftId: localSource?.draft_id ?? purchase?.draftId,
    orderId: localSource?.order_id ?? purchase?.orderId,
    countryName: source.trip?.countryName,
    deactivationDate:
      source.trip?.departureDate ??
      deactivationIsoFrom(source.trip?.arrivalDate ?? purchase?.date, validityDays),
    items,
    total: source.total != null ? Number(source.total).toFixed(2) : undefined,
    currency: source.currency,
    status: 'paid',
  };
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
  const [purchase, setPurchase] = useState<PurchaseData | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPaymentData | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [userEsims, setUserEsims] = useState<UserEsimRecord[]>([]);
  const [latestOrderBundle, setLatestOrderBundle] = useState<BundleDetail | null>(null);
  const [assignedSim, setAssignedSim] = useState<EsimAssignmentPayload | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [waitingForSim, setWaitingForSim] = useState(false);
  const [esimsError, setEsimsError] = useState('');
  const [showQrCode, setShowQrCode] = useState(false);
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpModalShown, setTopUpModalShown] = useState(false);
  const [topUpModalClosing, setTopUpModalClosing] = useState(false);
  const [topUpBundles, setTopUpBundles] = useState<TopUpBundle[]>([]);
  const [topUpBundlesLoading, setTopUpBundlesLoading] = useState(false);
  const [showReceiptPrompt, setShowReceiptPrompt] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
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

  const { isPolling: balancePolling, optimisticDataMb, confirmedDataMb } = useBalancePoll({
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

  useEffect(() => {
    if (!topUpModalOpen) return;

    let cancelled = false;
    setTopUpBundlesLoading(true);

    (async () => {
      try {
        const res = await BundlesApi.list<BundlesResponse>();
        const apiBundles = res.data?.bundles ?? [];
        const uiBundles: TopUpBundle[] = apiBundles
          .map((b) => {
            const dataMb = bundleToMb(b);
            return {
              id: b.id,
              sim_bundle_id: b.sim_bundle_id ?? null,
              name: displayBundleName(b.alias?.trim() || fallbackBundleName(dataMb) || b.name),
              data_mb: dataMb,
              validity_days: b.validity_days ?? undefined,
              price: b.price ?? undefined,
              currency: b.currency ?? undefined,
              tagline: bundleTagline(b.validity_days, dataMb),
            };
          })
          .filter((b) => !isHiddenCatalogBundle(b));
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
        getOptimisticDataMb() ?? dataMbFromAssignment(activeEsim) ?? 0;

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
      router.replace('/auth/login?redirect=/dashboard');
      return;
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const raw = localStorage.getItem('lastPurchase');
    if (raw) {
      try {
        setPurchase(JSON.parse(raw));
      } catch {
        setPurchase(null);
      }
    }
    setPendingPayment(readPendingPaymentFromStorage());
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

    return () => {
      window.removeEventListener('focus', refreshEsims);
      window.removeEventListener('pageshow', refreshEsims);
    };
  }, [isAuthenticated, loadEsims]);

  useEffect(() => {
    if (!isAuthenticated || ordersLoading) return;

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
          const isPhysicalPurchase =
            pendingPay?.simType === 'physical' ||
            hasPhysicalSimPurchase(ordersRef.current, pendingPay, purchaseRef.current);

          if (isPhysicalPurchase && !status.has_sim) {
            setWaitingForSim(false);
            setAssignmentLoading(false);
            return;
          }

          if (status.has_sim) {
            applyAssignedSim(status.data);
            setWaitingForSim(false);
            if (pendingPay?.simType === 'physical') {
              localStorage.removeItem('pendingPayment');
              setPendingPayment(null);
            }
            await loadEsims();
            setAssignmentLoading(false);
            return;
          }

          if (shouldPollAssignment(status)) {
            setWaitingForSim(true);
          } else {
            setWaitingForSim(false);
            await loadEsims();
            setAssignmentLoading(false);
            return;
          }

          if ((status.inventory?.available ?? 0) > 0) {
            const assignRes = await EsimsApi.register();
            if (signal.cancelled) return;

            if (assignRes.ok || assignRes.status === 201) {
              const assign = parseAssignmentStatus(assignRes.body);
              if (assign.has_sim) {
                applyAssignedSim(assign.data);
                setWaitingForSim(false);
                await loadEsims();
                setAssignmentLoading(false);
                return;
              }
            }
          }

          const delayMs = (status.retry_after_seconds ?? DEFAULT_RETRY_SECONDS) * 1000;
          await sleep(delayMs, signal);
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
  }, [isAuthenticated, applyAssignedSim, loadEsims, ordersLoading]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f6f8f6' }}>
        <Loader2 size={28} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const primaryUserEsim = userEsims[0] ?? null;
  const primaryBundle = purchase?.items?.[0]?.bundle;
  const apiBundle = primaryUserEsim?.bundle ?? latestOrderBundle ?? null;
  const orderItemDataAmount = coerceNumber(primaryUserEsim?.order_item?.data_amount);

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
      apiBundle?.name ??
      assignedSim?.bundle?.name ??
      primaryBundle?.name ??
      null
  ) || null;
  const assignedBundleDuration =
    apiBundle?.duration ??
    (apiBundle?.validity_days ? `${apiBundle.validity_days} days` : null) ??
    assignedSim?.bundle?.duration ??
    (primaryBundle?.validity_days ? `${primaryBundle.validity_days} days` : null);
  const planValidityLabel = assignedBundleDuration ?? '30 days';
  const bundleDataMb = resolveBundleDataMb(
    primaryUserEsim?.bundle,
    latestOrderBundle,
    assignedSim?.bundle,
    primaryBundle,
    orderItemDataAmount
  );

  const carrierDataMb = dataMbFromAssignment(primaryUserEsim);
  const displayDataMb =
    confirmedDataMb ??
    optimisticDataMb ??
    carrierDataMb ??
    bundleDataMb;

  const balanceStatusSub = balancePolling
    ? 'Updating with carrier balance…'
    : confirmedDataMb != null
      ? 'Live balance from carrier'
      : optimisticDataMb != null
        ? 'Estimated until carrier confirms'
        : bundleDataMb != null
          ? apiBundle?.name
            ? `${apiBundle.name} bundle`
            : 'Bundle data allowance'
          : 'No bundle data';

  const simType = primaryUserEsim?.esim?.sim_type ?? assignedSim?.esim?.sim_type ?? 'esim';
  const isEsimType = simType.toLowerCase() !== 'physical';
  const simStatus = primaryUserEsim?.esim?.status ?? assignedSim?.esim?.status ?? null;
  const simIsActive = isEsimType
    ? Boolean(primaryUserEsim?.device_activated_at)
    : isSimActive(simStatus);
  const simStatusDisplay = isEsimType
    ? esimDeviceStatusLabel(primaryUserEsim, simStatus)
    : simStatusLabel(simStatus);
  const simTypeTitle = simTypeLabel(simType);

  const hasActiveEsim =
    Boolean(assignedMsisdn) || userEsims.length > 0;

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
    (assignedMsisdn ? formatMsisdn(assignedMsisdn) : null) ??
    'eSIM';

  const latestPaidOrder = orders
    .filter(isPaidOrder)
    .sort(
      (a, b) =>
        new Date(b.paid_at ?? b.created_at).getTime() -
        new Date(a.paid_at ?? a.created_at).getTime()
    )[0];
  const planValidityDays =
    coerceNumber(latestPaidOrder?.order_items?.[0]?.validity_days) ??
    coerceNumber(apiBundle?.validity_days) ??
    coerceNumber(primaryBundle?.validity_days) ??
    30;
  const scheduledActivationIso =
    purchase?.trip?.arrivalDate ?? latestPaidOrder?.trip?.arrival_date ?? null;
  const planStartIso = simIsActive
    ? (primaryUserEsim?.device_activated_at ??
      scheduledActivationIso ??
      primaryUserEsim?.created_at ??
      latestPaidOrder?.paid_at ??
      latestPaidOrder?.created_at ??
      null)
    : scheduledActivationIso;
  const deactivationIso = simIsActive
    ? deactivationIsoFrom(planStartIso, planValidityDays)
    : (purchase?.trip?.departureDate ??
      latestPaidOrder?.trip?.departure_date ??
      deactivationIsoFrom(scheduledActivationIso, planValidityDays));
  const daysRemaining = simIsActive ? daysUntil(deactivationIso) : null;
  const daysRemainingLabel = daysLeftLabel(daysRemaining);
  const validityProgressPct = !simIsActive
    ? 8
    : daysRemaining == null
      ? 0
      : daysRemaining <= 0
        ? 0
        : Math.min(100, Math.max(4, Math.round((daysRemaining / Math.max(planValidityDays, 1)) * 100)));

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f6f8f6' }}>
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
          <p className="max-w-5xl mx-auto text-sm text-emerald-800">
            Balance updated with your purchase. Waiting for carrier confirmation (usually within a few minutes)…
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
                        {bundle.validity_days ?? 30} days · {bundle.currency ?? 'USD'}{' '}
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
        {esimsError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {esimsError}
          </div>
        )}

        {showReceiptPrompt && (
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

        {waitingForSim && !hasActiveEsim && !isPhysicalSimAwaitingPickup && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 flex items-start gap-3">
            <Loader2 size={20} className="animate-spin text-sky-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-sky-900">
                We&apos;re assigning your number. This may take a few minutes.
              </p>
              <p className="text-xs text-sky-700 mt-1">
                We&apos;ll update this page automatically when your SIM is ready.
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

        {assignmentLoading && !hasActiveEsim && !waitingForSim && !isPhysicalSimAwaitingPickup ? (
          <div className="rounded-2xl p-12 flex items-center justify-center bg-white border border-slate-100">
            <Loader2 size={28} className="animate-spin text-slate-400" />
          </div>
        ) : hasActiveEsim ? (
          <>
            {/* Activation instructions — shown first so users know what the buttons below do */}
            {isEsimType && !primaryUserEsim?.device_activated_at && (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Info size={18} style={{ color: '#17cf54' }} />
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-600">
                    How to Install &amp; Activate Your eSIM
                  </h3>
                </div>
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
                    {!simIsActive && formatTripDate(scheduledActivationIso) && (
                      <div className="mt-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                          Scheduled activation
                        </p>
                        <p className="text-sm font-bold mt-0.5" style={{ color: '#17cf54' }}>
                          {formatTripDate(scheduledActivationIso)}
                        </p>
                      </div>
                    )}
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

              {simIsActive && (formatTripDate(planStartIso) || formatTripDate(deactivationIso)) && (
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
                    Plan remaining
                  </p>
                  <p className="text-xs font-bold text-white">
                    {simIsActive ? (daysRemainingLabel ?? '—') : 'Not started'}
                  </p>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={validityProgressPct}
                  aria-label="Plan time remaining"
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${validityProgressPct}%`,
                      backgroundColor:
                        !simIsActive
                          ? 'rgba(255,255,255,0.35)'
                          : validityProgressPct <= 15
                            ? '#f59e0b'
                            : '#17cf54',
                    }}
                  />
                </div>
              </div>

              {assignedMsisdn && balanceAreaValue !== '—' && (
                <p className="text-sm text-white/60 mt-3">{balanceAreaValue} data plan</p>
              )}

              {isEsimType && primaryUserEsim?.id && (
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
                  />

                  {!primaryUserEsim.device_activated_at && hasActivationData && (
                    <button
                      type="button"
                      onClick={() => setShowQrCode((v) => !v)}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold border border-white/25 text-white hover:bg-white/10 transition-colors"
                    >
                      {showQrCode ? 'Hide QR Code' : 'Open QR Code'}
                    </button>
                  )}
                </div>
              )}

              {isEsimType &&
                primaryUserEsim?.id &&
                !primaryUserEsim.device_activated_at &&
                hasActivationData &&
                showQrCode && (
                  <QrCodePanel
                    userEsimId={primaryUserEsim.id}
                    qrCodeData={assignedQrCodeData}
                    msisdn={assignedMsisdn}
                    iccid={assignedIccid}
                  />
                )}

              {isEsimType &&
                !primaryUserEsim?.device_activated_at &&
                hasActivationData &&
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
                  sub: isEsimType
                    ? esimDeviceStatusLabel(primaryUserEsim, simStatus)
                    : simStatusLabel(simStatus),
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
                  value: simIsActive
                    ? (daysRemainingLabel ?? planValidityLabel)
                    : `Valid for ${planValidityDays} days`,
                  sub: simIsActive
                    ? formatTripDate(deactivationIso)
                      ? `Valid for ${planValidityDays} days · Deactivates ${formatTripDate(deactivationIso)}`
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
        ) : isPhysicalSimAwaitingPickup ? null : (
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
