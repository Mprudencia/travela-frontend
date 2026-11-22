const AWAIT_SINCE_KEY = 'travela_await_balance_since';
const AWAIT_MSISDN_KEY = 'travela_await_balance_msisdn';
const OPTIMISTIC_DATA_MB_KEY = 'travela_optimistic_data_mb';

const RECEIPT_PROMPT_KEY = 'travela:showReceiptPrompt';
const RECEIPT_ORDER_KEY = 'travela:receiptOrderId';
const CHECKOUT_TRANSITION_KEY = 'travela:checkout-transition';

export type BalancePollContext = {
  since: string;
  msisdn?: string;
};

function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

function writeStored(key: string, value: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(key, value);
  localStorage.setItem(key, value);
}

function removeStored(key: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}

/** Ask the dashboard to poll this user's backend balance after checkout. */
export function startBalancePoll(opts: { msisdn?: string }) {
  if (typeof window === 'undefined') return;

  removeStored(OPTIMISTIC_DATA_MB_KEY);
  writeStored(AWAIT_SINCE_KEY, new Date().toISOString());

  if (opts.msisdn) {
    writeStored(AWAIT_MSISDN_KEY, opts.msisdn);
  } else {
    removeStored(AWAIT_MSISDN_KEY);
  }
}

export function getBalancePollContext(): BalancePollContext | null {
  if (typeof window === 'undefined') return null;

  const since = readStored(AWAIT_SINCE_KEY);
  if (!since) return null;

  const msisdn = readStored(AWAIT_MSISDN_KEY);
  return msisdn ? { since, msisdn } : { since };
}

export function clearBalancePoll() {
  if (typeof window === 'undefined') return;
  removeStored(AWAIT_SINCE_KEY);
  removeStored(AWAIT_MSISDN_KEY);
  removeStored(OPTIMISTIC_DATA_MB_KEY);
}

/** Drop purchase and balance leftovers. Does not touch the auth token. */
export function clearStoredPurchaseData() {
  if (typeof window === 'undefined') return;
  clearBalancePoll();
  localStorage.removeItem('lastPurchase');
  localStorage.removeItem('pendingPayment');
  localStorage.removeItem('cart');
  sessionStorage.removeItem(RECEIPT_PROMPT_KEY);
  sessionStorage.removeItem(RECEIPT_ORDER_KEY);
  sessionStorage.removeItem(CHECKOUT_TRANSITION_KEY);
}

export function initBalancePollFromUrl() {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const hasPurchaseHint = params.get('await_balance') === '1' || params.has('purchased_mb');
  if (!hasPurchaseHint) return;

  const urlMsisdn = params.get('msisdn') || undefined;
  if (!getBalancePollContext()) {
    startBalancePoll({ msisdn: urlMsisdn });
    return;
  }

  if (urlMsisdn) {
    writeStored(AWAIT_MSISDN_KEY, urlMsisdn);
  }
}
