import { OrderApi } from '@/lib/api';

const DISMISSED_KEY = 'travela:dismissedUnpaidOrders';

export function readDismissedUnpaidOrderIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
  } catch {
    return [];
  }
}

export function dismissUnpaidOrder(orderId: string | number) {
  const ids = new Set(readDismissedUnpaidOrderIds());
  ids.add(String(orderId));
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  clearPendingPayment(orderId);
  try {
    sessionStorage.removeItem('travela:showReceiptPrompt');
    sessionStorage.removeItem('travela:receiptOrderId');
  } catch {
    /* ignore */
  }
}

function clearPendingPayment(orderId: string | number) {
  try {
    const raw = localStorage.getItem('pendingPayment');
    if (!raw) return;
    const pending = JSON.parse(raw) as { order_id?: string | number };
    if (pending.order_id == null || String(pending.order_id) === String(orderId)) {
      localStorage.removeItem('pendingPayment');
    }
  } catch {
    localStorage.removeItem('pendingPayment');
  }
}

/** Ask the API to cancel, then hide the order locally so the customer can start over. */
export async function abandonUnpaidOrder(orderId: string | number) {
  try {
    await OrderApi.cancel(orderId);
  } catch {
    /* Local dismiss still lets them choose a plan again. */
  }
  dismissUnpaidOrder(orderId);
}
