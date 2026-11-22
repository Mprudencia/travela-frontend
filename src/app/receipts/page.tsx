'use client';

import { useAuth } from '@/lib/auth-context';
import { OrderApi } from '@/lib/api';
import { downloadReceiptPdf } from '@/lib/receipt-pdf';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Filter,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface OrderItemBundle {
  name?: string;
  data_mb?: number | null;
  bundle_size?: string | null;
  unit?: string | null;
}

interface OrderItem {
  id: number;
  bundle_name: string;
  data_amount: number | null;
  validity_days: number;
  price: string;
  currency: string;
  created_at?: string | null;
  updated_at?: string | null;
  bundle?: OrderItemBundle | null;
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
  updated_at?: string | null;
  /** Payment gateway's own transaction/payment id — used as the receipt's "Payment ID" */
  gateway_payment_id?: string | null;
  payment_gateway?: string | null;
  payment_callback?: {
    payload?: { payment_id?: string | null } | null;
  } | null;
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
  order_items?: OrderItem[];
}

/** Onnela Limited operates thetravela.com — shown on every receipt. */
const MERCHANT = {
  legalName: 'Onnela Limited',
  brand: 'TheTravela',
  tin: '190-430-618',
  address: 'Dar Es Salaam, Tanzania',
};

const VAT_RATE = 0.18;

/** Totals are VAT-inclusive — back out the VAT portion at 18%. */
function vatFromInclusiveTotal(total: number, rate: number = VAT_RATE) {
  return (total * rate) / (1 + rate);
}

function paymentIdFor(order: OrderRecord): string {
  return (
    order.gateway_payment_id ||
    order.payment_callback?.payload?.payment_id ||
    order.payment_reference ||
    '—'
  );
}

function orderRefFor(order: OrderRecord): string {
  return order.payment_reference || order.draft_id || `ORD-${order.id}`;
}

function formatMb(mb?: number | null) {
  if (mb == null || mb <= 0) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

function formatItemData(item: OrderItem) {
  const mb =
    item.data_amount ??
    item.bundle?.data_mb ??
    (item.bundle?.bundle_size ? Number(item.bundle.bundle_size) : null);
  return formatMb(mb);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const now = new Date();
  const time = formatTime(iso);
  const dayDiff =
    (startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / 86_400_000;

  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Yesterday at ${time}`;

  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
    return `${weekday} at ${time}`;
  }

  const datePart = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });

  return `${datePart} at ${time}`;
}

function formatFullDateTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const datePart = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${datePart} at ${formatTime(iso)}`;
}

type StatusFilter = 'all' | 'paid' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'other';
type SortKey = 'date' | 'amount' | 'status';
type SortDir = 'asc' | 'desc';

function orderStatus(order: OrderRecord) {
  return (order.payment_status || order.status || 'pending').toLowerCase();
}

function statusBucket(status: string): Exclude<StatusFilter, 'all'> {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'completed') return 'paid';
  if (
    s.includes('fail') ||
    s.includes('declin') ||
    s.includes('error')
  ) {
    return 'failed';
  }
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('expir')) return 'expired';
  if (
    s.includes('pending') ||
    s === 'unpaid' ||
    s === 'awaiting_payment' ||
    s === 'payment_required' ||
    s === 'initiated' ||
    s === 'created' ||
    s === 'draft' ||
    !s
  ) {
    return 'pending';
  }
  return 'other';
}

function statusLabel(status: string) {
  const bucket = statusBucket(status);
  if (bucket === 'paid') return 'Paid';
  if (bucket === 'failed') return 'Failed';
  if (bucket === 'cancelled') return 'Cancelled';
  if (bucket === 'expired') return 'Expired';
  if (bucket === 'pending') return 'Pending';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusStyles(status: string): { backgroundColor: string; color: string; dot: string } {
  const bucket = statusBucket(status);
  if (bucket === 'paid') {
    return {
      backgroundColor: 'rgba(23,207,84,0.14)',
      color: '#14532d',
      dot: '#17cf54',
    };
  }
  if (bucket === 'failed') {
    return {
      backgroundColor: 'rgba(239,68,68,0.12)',
      color: '#991b1b',
      dot: '#ef4444',
    };
  }
  if (bucket === 'cancelled') {
    return {
      backgroundColor: 'rgba(100,116,139,0.14)',
      color: '#334155',
      dot: '#64748b',
    };
  }
  if (bucket === 'expired') {
    return {
      backgroundColor: 'rgba(245,158,11,0.14)',
      color: '#92400e',
      dot: '#f59e0b',
    };
  }
  if (bucket === 'pending') {
    return {
      backgroundColor: 'rgba(59,130,246,0.12)',
      color: '#1e40af',
      dot: '#3b82f6',
    };
  }
  return {
    backgroundColor: 'rgba(148,163,184,0.15)',
    color: '#475569',
    dot: '#94a3b8',
  };
}

function StatusBadge({ status }: { status: string }) {
  const styles = statusStyles(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ backgroundColor: styles.backgroundColor, color: styles.color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: styles.dot }}
        aria-hidden
      />
      {statusLabel(status)}
    </span>
  );
}

function orderPlanLabel(order: OrderRecord) {
  const item = order.order_items?.[0];
  if (!item) return '—';
  const data = formatItemData(item);
  const name = item.bundle_name || item.bundle?.name || 'Plan';
  return data !== '—' ? `${name} · ${data}` : name;
}

function orderDateIso(order: OrderRecord) {
  return order.updated_at ?? order.paid_at ?? order.created_at;
}

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'paid', label: 'Paid' },
  { id: 'pending', label: 'Pending' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'expired', label: 'Expired' },
];

function parseOrdersFromBody(body: unknown): OrderRecord[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as { data?: unknown };
  if (!Array.isArray(b.data)) return [];
  return b.data as OrderRecord[];
}

function ReceiptModal({ order, onClose }: { order: OrderRecord; onClose: () => void }) {
  const items = order.order_items ?? [];
  const total = Number(order.total_amount || 0);
  const vat = vatFromInclusiveTotal(total);
  const currency = order.currency || 'USD';
  const isPaid = (order.payment_status || order.status || '').toLowerCase() === 'paid';
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const handleDownloadPdf = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadReceiptPdf({
        orderRef: orderRefFor(order),
        paymentId: paymentIdFor(order),
        paidAtLabel: formatFullDateTime(order.paid_at ?? order.created_at),
        statusLabel: isPaid ? 'Paid' : statusLabel(order.payment_status || order.status),
        currency,
        total,
        vat,
        vatRatePercent: VAT_RATE * 100,
        items: items.map((item) => ({
          id: item.id,
          dataLabel: formatItemData(item),
          validityDays: item.validity_days,
          price: Number(item.price),
          currency: item.currency ?? currency,
        })),
        merchant: MERCHANT,
      });
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not download PDF.';
      setDownloadError(msg || 'Could not download PDF.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-2xl border border-slate-100 w-full sm:max-w-sm max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 -mt-1.5 rounded-full text-slate-400 hover:bg-slate-100"
            aria-label="Close receipt"
          >
            <X size={18} />
          </button>
        </div>

        <div className="text-center mb-5">
          <Image
            src="/logos/travela_dark.png"
            alt={MERCHANT.brand}
            width={130}
            height={40}
            className="h-8 w-auto object-contain mx-auto mb-3"
          />
          <h2 className="text-xl font-extrabold text-slate-900">Receipt</h2>
          <div className="mt-2 flex justify-center">
            <StatusBadge status={isPaid ? 'paid' : order.payment_status || order.status} />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {formatFullDateTime(order.paid_at ?? order.created_at)}
          </p>
        </div>

        <div className="border-t border-dashed border-slate-200 pt-4 mb-4 text-center">
          <Image
            src="/logos/onnela_logo.png"
            alt="Onnela"
            width={72}
            height={24}
            className="h-4 w-auto object-contain opacity-70 mx-auto mb-2"
          />
          <p className="text-xs text-slate-500">{MERCHANT.legalName}</p>
          <p className="text-xs text-slate-500">TIN: {MERCHANT.tin}</p>
          <p className="text-xs text-slate-500">{MERCHANT.address}</p>
        </div>

        <div className="border-t border-dashed border-slate-200 pt-4 mb-4">
          {items.length === 0 ? (
            <p className="text-sm text-slate-500 text-center">No line items on this order.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-1">
                <p className="text-sm text-slate-700">
                  Data {formatItemData(item)}
                  {item.validity_days ? `, ${item.validity_days} days` : ''}
                </p>
                <p className="text-sm font-semibold text-slate-800 flex-shrink-0">
                  {item.currency ?? currency} {Number(item.price).toFixed(2)}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-dashed border-slate-200 pt-4 mb-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">Total</p>
            <p className="text-sm font-extrabold" style={{ color: '#112116' }}>
              {currency} {total.toFixed(2)}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Incl. VAT</p>
            <p className="text-xs text-slate-500">
              {currency} {vat.toFixed(2)}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">VAT rate</p>
            <p className="text-xs text-slate-500">{(VAT_RATE * 100).toFixed(0)}%</p>
          </div>
        </div>

        <div className="border-t border-dashed border-slate-200 pt-4 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">Order ref</p>
            <p className="text-xs font-semibold text-slate-700 truncate">{orderRefFor(order)}</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">Payment ID</p>
            <p className="text-xs font-semibold text-slate-700 truncate">{paymentIdFor(order)}</p>
          </div>
        </div>

        {downloadError && (
          <p className="mt-4 text-xs font-medium text-red-600 text-center">{downloadError}</p>
        )}

        <button
          type="button"
          onClick={() => void handleDownloadPdf()}
          disabled={downloading}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: '#112116' }}
        >
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {downloading ? 'Preparing PDF…' : 'Download PDF'}
        </button>
        <p className="mt-2 text-[11px] text-slate-400 text-center leading-relaxed">
          Downloads the receipt as a PDF to your device.
        </p>
      </div>
    </div>
  );
}

export default function ReceiptsPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: '#f6f8f6' }}
        >
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      }
    >
      <ReceiptsContent />
    </Suspense>
  );
}

function ReceiptsContent() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const orderIdParam = searchParams.get('orderId');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const autoOpenedOrderId = useRef<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await OrderApi.listMine();
      if (!res.ok) {
        const msg =
          res.body &&
          typeof res.body === 'object' &&
          typeof (res.body as { message?: unknown }).message === 'string'
            ? String((res.body as { message: string }).message)
            : `Could not load orders (HTTP ${res.status}).`;
        setError(msg);
        setOrders([]);
        return;
      }
      setOrders(parseOrdersFromBody(res.body));
    } catch (e: unknown) {
      const fallback =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setError(fallback || 'Failed to load transaction history.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setOrders([]);
      setLoading(false);
      return;
    }
    void loadOrders();
  }, [isAuthenticated, authLoading, loadOrders]);

  useEffect(() => {
    if (!orderIdParam || orders.length === 0) return;
    if (autoOpenedOrderId.current === orderIdParam) return;
    const match = orders.find((o) => String(o.id) === String(orderIdParam));
    if (!match) return;
    if (statusBucket(orderStatus(match)) === 'paid') {
      autoOpenedOrderId.current = orderIdParam;
      setSelectedOrder(match);
    }
  }, [orderIdParam, orders]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: orders.length,
      paid: 0,
      pending: 0,
      failed: 0,
      cancelled: 0,
      expired: 0,
      other: 0,
    };
    for (const order of orders) {
      counts[statusBucket(orderStatus(order))] += 1;
    }
    return counts;
  }, [orders]);

  const visibleFilters = useMemo(
    () =>
      STATUS_FILTERS.filter(
        (filter) => filter.id === 'all' || statusCounts[filter.id] > 0
      ),
    [statusCounts]
  );

  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = orders.filter((order) => {
      const status = orderStatus(order);
      if (statusFilter !== 'all' && statusBucket(status) !== statusFilter) return false;
      if (!needle) return true;
      const haystack = [
        String(order.id),
        order.draft_id,
        order.payment_reference,
        order.gateway_payment_id,
        order.metadata?.countryName,
        order.trip?.destination_country,
        order.metadata?.simType,
        orderPlanLabel(order),
        statusLabel(status),
        ...(order.order_items ?? []).map(
          (item) => `${item.bundle_name ?? ''} ${item.bundle?.name ?? ''}`
        ),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'amount') {
        return (Number(a.total_amount) - Number(b.total_amount)) * dir;
      }
      if (sortKey === 'status') {
        return statusLabel(orderStatus(a)).localeCompare(statusLabel(orderStatus(b))) * dir;
      }
      return (
        (Date.parse(orderDateIso(a) ?? '') - Date.parse(orderDateIso(b) ?? '')) * dir
      );
    });
  }, [orders, query, sortDir, sortKey, statusFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'date' ? 'desc' : 'asc');
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  if (authLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <Loader2 size={28} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ backgroundColor: '#f6f8f6' }}
      >
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-sm w-full">
          <Receipt size={32} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-lg font-extrabold text-slate-900 mb-2">Transaction History</h2>
          <p className="text-sm text-slate-500 mb-5">Sign in to view your order history.</p>
          <Link
            href="/auth/login"
            className="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold text-white hover:opacity-90"
            style={{ backgroundColor: '#112116' }}
          >
            Sign In <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f6f8f6' }}>
      <div className="bg-white border-b border-slate-100 px-4 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-0.5">
              Travela
            </p>
            <h1 className="text-xl font-extrabold text-slate-900">Transaction History</h1>
            <p className="text-sm text-slate-500 mt-1">
              Filter and review every purchase, payment, and receipt.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => void loadOrders()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              aria-label="Refresh transactions"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link
              href="/bundles?country=TZ&countryName=Tanzania"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90"
              style={{ backgroundColor: '#112116' }}
            >
              Buy eSIM
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
        {loading && orders.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader2 size={28} className="animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-red-100 p-8 text-center">
            <p className="text-sm font-semibold text-red-700 mb-4">{error}</p>
            <button
              type="button"
              onClick={() => void loadOrders()}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90"
              style={{ backgroundColor: '#112116' }}
            >
              Try again
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
            <Receipt size={36} className="mx-auto mb-4 text-slate-200" />
            <p className="text-sm font-semibold text-slate-500">No transactions yet.</p>
            <p className="text-xs text-slate-400 mt-1 mb-5">
              Your purchases will appear here once you buy an eSIM.
            </p>
            <Link
              href="/bundles?country=TZ&countryName=Tanzania"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90"
              style={{ backgroundColor: '#112116' }}
            >
              Get an eSIM <ArrowRight size={15} />
            </Link>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="relative flex-1">
                  <Search
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by plan, order, reference, or country…"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
                  />
                </div>
                <p className="text-xs font-semibold text-slate-500 lg:text-right flex items-center gap-1.5">
                  <Filter size={13} />
                  {filteredOrders.length} of {orders.length} shown
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {visibleFilters.map((filter) => {
                  const active = statusFilter === filter.id;
                  const count = statusCounts[filter.id];
                  const sampleStyle =
                    filter.id === 'all'
                      ? { backgroundColor: 'rgba(17,33,22,0.08)', color: '#112116', dot: '#112116' }
                      : statusStyles(filter.id);
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setStatusFilter(filter.id)}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold border transition-colors ${
                        active
                          ? 'border-transparent text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                      style={
                        active
                          ? { backgroundColor: '#112116' }
                          : undefined
                      }
                    >
                      {filter.id !== 'all' && (
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: active ? '#17cf54' : sampleStyle.dot }}
                          aria-hidden
                        />
                      )}
                      {filter.label}
                      <span
                        className={`min-w-5 text-center rounded-full px-1.5 py-0.5 text-[10px] ${
                          active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                <p className="text-sm font-semibold text-slate-600">No matching transactions</p>
                <p className="text-xs text-slate-400 mt-1 mb-4">
                  Try another status filter or clear your search.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('all');
                    setQuery('');
                  }}
                  className="text-sm font-bold underline"
                  style={{ color: '#112116' }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/80">
                          <th className="px-5 py-3.5">
                            <button
                              type="button"
                              onClick={() => toggleSort('date')}
                              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800"
                            >
                              Date <SortIcon column="date" />
                            </button>
                          </th>
                          <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                            Plan
                          </th>
                          <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                            Reference
                          </th>
                          <th className="px-5 py-3.5">
                            <button
                              type="button"
                              onClick={() => toggleSort('status')}
                              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800"
                            >
                              Status <SortIcon column="status" />
                            </button>
                          </th>
                          <th className="px-5 py-3.5">
                            <button
                              type="button"
                              onClick={() => toggleSort('amount')}
                              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800"
                            >
                              Amount <SortIcon column="amount" />
                            </button>
                          </th>
                          <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 text-right">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.map((order) => {
                          const status = orderStatus(order);
                          const paid = statusBucket(status) === 'paid';
                          const countryName =
                            order.metadata?.countryName ?? order.trip?.destination_country;
                          const simType = order.metadata?.simType;
                          return (
                            <tr
                              key={order.id}
                              className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70 transition-colors"
                            >
                              <td className="px-5 py-4 align-middle">
                                <p className="text-sm font-semibold text-slate-900">
                                  {formatDateTime(orderDateIso(order))}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">Order #{order.id}</p>
                              </td>
                              <td className="px-5 py-4 align-middle min-w-0">
                                <p className="text-sm font-bold text-slate-900 truncate">
                                  {orderPlanLabel(order)}
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5 truncate">
                                  {[
                                    countryName,
                                    simType === 'esim'
                                      ? 'eSIM'
                                      : simType === 'physical'
                                        ? 'Physical SIM'
                                        : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ') || '—'}
                                </p>
                              </td>
                              <td className="px-5 py-4 align-middle">
                                <p className="text-sm font-medium text-slate-700 truncate max-w-[12rem]">
                                  {order.payment_reference || order.draft_id || '—'}
                                </p>
                              </td>
                              <td className="px-5 py-4 align-middle">
                                <StatusBadge status={status} />
                              </td>
                              <td className="px-5 py-4 align-middle">
                                <p className="text-sm font-extrabold text-slate-900">
                                  {order.currency} {Number(order.total_amount).toFixed(2)}
                                </p>
                              </td>
                              <td className="px-5 py-4 align-middle text-right">
                                {paid ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedOrder(order)}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-white"
                                  >
                                    <Eye size={14} />
                                    Receipt
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {filteredOrders.map((order) => {
                    const status = orderStatus(order);
                    const paid = statusBucket(status) === 'paid';
                    const countryName =
                      order.metadata?.countryName ?? order.trip?.destination_country;
                    return (
                      <div
                        key={order.id}
                        className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="min-w-0">
                            <p className="text-xs text-slate-400">
                              {formatDateTime(orderDateIso(order))}
                            </p>
                            <p className="text-sm font-extrabold text-slate-900 mt-0.5 truncate">
                              {orderPlanLabel(order)}
                            </p>
                            {countryName && (
                              <p className="text-xs text-slate-500 mt-0.5">{countryName}</p>
                            )}
                          </div>
                          <StatusBadge status={status} />
                        </div>
                        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                              Total
                            </p>
                            <p className="text-sm font-extrabold text-slate-900">
                              {order.currency} {Number(order.total_amount).toFixed(2)}
                            </p>
                          </div>
                          {paid ? (
                            <button
                              type="button"
                              onClick={() => setSelectedOrder(order)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-700"
                            >
                              <Eye size={14} />
                              Receipt
                            </button>
                          ) : (
                            <p className="text-xs text-slate-400 truncate max-w-[40%]">
                              {order.payment_reference || order.draft_id || `Order #${order.id}`}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {selectedOrder && (
        <ReceiptModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  );
}
