'use client';

import { useAuth } from '@/lib/auth-context';
import { OrderApi } from '@/lib/api';
import { ArrowRight, Loader2, Printer, Receipt, RefreshCw, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

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

function bundleUpdatedAt(item: OrderItem, order: OrderRecord): string | null {
  return item.updated_at ?? order.updated_at ?? order.paid_at ?? order.created_at ?? null;
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusStyles(status: string) {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'completed') {
    return { backgroundColor: 'rgba(23,207,84,0.12)', color: '#112116' };
  }
  if (s === 'pending' || s === 'pending_payment') {
    return { backgroundColor: 'rgba(245,158,11,0.12)', color: '#92400e' };
  }
  return { backgroundColor: 'rgba(148,163,184,0.15)', color: '#475569' };
}

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4 print:bg-white print:static"
      onClick={onClose}
    >
      <div
        className="receipt-print bg-white rounded-t-3xl sm:rounded-2xl border border-slate-100 w-full sm:max-w-sm max-h-[90vh] overflow-y-auto p-6 print:max-h-none print:overflow-visible print:border-0 print:rounded-none print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1 print:hidden">
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
          <span
            className="inline-block mt-2 text-xs font-bold px-2.5 py-1 rounded-full"
            style={statusStyles(order.payment_status || order.status)}
          >
            {isPaid ? 'Paid' : statusLabel(order.payment_status || order.status)}
          </span>
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

        <button
          type="button"
          onClick={() => window.print()}
          className="print:hidden mt-6 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90"
          style={{ backgroundColor: '#112116' }}
        >
          <Printer size={16} />
          Download / Save as PDF
        </button>
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .receipt-print,
          .receipt-print * {
            visibility: visible;
          }
          .receipt-print {
            position: fixed;
            inset: 0;
            width: 100%;
            max-width: 420px;
            margin: 24px auto;
          }
        }
      `}</style>
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

  // Deep-link from dashboard: open the matching paid receipt once (don't reopen after close)
  useEffect(() => {
    if (!orderIdParam || orders.length === 0) return;
    if (autoOpenedOrderId.current === orderIdParam) return;
    const match = orders.find((o) => String(o.id) === String(orderIdParam));
    if (!match) return;
    const status = (match.payment_status || match.status || '').toLowerCase();
    if (status === 'paid' || status === 'completed') {
      autoOpenedOrderId.current = orderIdParam;
      setSelectedOrder(match);
    }
  }, [orderIdParam, orders]);

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
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-0.5">Travela</p>
            <h1 className="text-xl font-extrabold text-slate-900">Transaction History</h1>
          </div>
          <Link
            href="/bundles?country=TZ&countryName=Tanzania&topup=1"
            className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors hover:bg-slate-50"
            style={{
              backgroundColor: 'rgba(23,207,84,0.08)',
              borderColor: 'rgba(23,207,84,0.3)',
              color: '#112116',
            }}
          >
            <RefreshCw size={16} />
            Top up
          </Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {loading ? (
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
              Your completed purchases will appear here as transaction history.
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
          <div className="space-y-4">
            {orders.map((order) => {
              const displayStatus = order.payment_status || order.status;
              const countryName = order.metadata?.countryName ?? order.trip?.destination_country;
              const simType = order.metadata?.simType;
              const items = order.order_items ?? [];

              return (
                <div key={order.id} className="bg-white rounded-2xl border border-slate-100 p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-400">
                        {order.updated_at ? 'Updated' : order.paid_at ? 'Paid' : 'Ordered'}{' '}
                        {formatDateTime(order.updated_at ?? order.paid_at ?? order.created_at)}
                      </p>
                      {countryName && (
                        <p className="text-sm font-bold text-slate-800">{countryName}</p>
                      )}
                      {order.payment_reference && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          Ref: {order.payment_reference}
                        </p>
                      )}
                      {(simType || order.draft_id) && (
                        <p className="text-xs text-slate-400 mt-1">
                          {simType === 'esim' ? 'eSIM' : simType === 'physical' ? 'Physical SIM' : null}
                          {simType && order.draft_id ? ' · ' : null}
                          {order.draft_id ? `Draft ${order.draft_id}` : null}
                        </p>
                      )}
                    </div>
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 capitalize"
                      style={statusStyles(displayStatus)}
                    >
                      {statusLabel(displayStatus)}
                    </span>
                  </div>

                  {items.length === 0 ? (
                    <p className="text-sm text-slate-500 border-t border-slate-50 pt-3">
                      No line items on this order.
                    </p>
                  ) : (
                    items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-2 border-t border-slate-50 gap-3"
                      >
                        <div className="text-sm text-slate-700 min-w-0">
                          <p>
                            <span className="font-bold text-slate-900">{formatItemData(item)}</span>
                            {' · '}
                            {item.bundle_name || item.bundle?.name || 'Bundle'}
                            {item.validity_days ? ` · ${item.validity_days} days` : ''}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Bundle updated {formatDateTime(bundleUpdatedAt(item, order))}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-slate-800 flex-shrink-0">
                          {item.currency ?? order.currency}{' '}
                          {Number(item.price).toFixed(2)}
                        </p>
                      </div>
                    ))
                  )}

                  <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
                    <p className="text-sm font-bold text-slate-700">Total</p>
                    <p className="text-base font-extrabold" style={{ color: '#112116' }}>
                      {order.currency} {Number(order.total_amount).toFixed(2)}
                    </p>
                  </div>

                  {(displayStatus.toLowerCase() === 'paid' ||
                    displayStatus.toLowerCase() === 'completed') && (
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(order)}
                      className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border-2 transition-colors hover:bg-slate-50"
                      style={{
                        backgroundColor: 'rgba(23,207,84,0.08)',
                        borderColor: 'rgba(23,207,84,0.3)',
                        color: '#112116',
                      }}
                    >
                      <Receipt size={14} />
                      View Receipt
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedOrder && (
        <ReceiptModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  );
}
