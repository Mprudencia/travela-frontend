/**
 * API client for Travela backend.
 *
 * Override with NEXT_PUBLIC_BASE_URL (no trailing slash) if needed.
 */

const PUBLIC_API_BASE =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ??
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ??
  "https://api.thetravela.com/api";

/** Fired when an authenticated API call returns 401 — listeners should clear the session. */
export const AUTH_SESSION_EXPIRED = "travela-auth-session-expired";

const DEVICE_ID_KEY = "travela_device_id";

/** Stable per-browser id so logins on other devices do not revoke this session. */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "web";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id.slice(0, 120);
}

function notifySessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED));
}

function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

type AuthFetchInit = RequestInit & {
  /** When false, do not attach Bearer token or handle 401 logout. */
  auth?: boolean;
};

/** Authenticated fetch — triggers session expiry handling on 401. */
async function authFetch(url: string, init: AuthFetchInit = {}): Promise<Response> {
  const { auth = true, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  if (auth) {
    const token = getBearerToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...rest, headers });

  if (auth && res.status === 401 && getBearerToken()) {
    notifySessionExpired();
  }

  return res;
}

async function toApiResult(res: Response): Promise<ApiResult> {
  const body = await parseResponseBody(res);
  return { ok: res.ok, status: res.status, body };
}

async function getJson<T>(url: string): Promise<{ data: T }> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}) ${url}${text ? ` — ${text}` : ""}`);
  }
  return { data: (await res.json()) as T };
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export type RegisterResult = {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or plain text if invalid JSON */
  body: unknown;
};

export type ApiResult = {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or plain text if invalid JSON */
  body: unknown;
};

export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; errors?: Record<string, string[]> };
    if (typeof b.message === "string") return b.message;
    if (b.errors && typeof b.errors === "object") {
      const first = Object.values(b.errors).flat()[0];
      if (typeof first === "string") return first;
    }
  }
  return fallback;
}

/** First validation message per Laravel field key. */
export function apiFieldErrors(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const b = body as { errors?: Record<string, string[]> };
  if (!b.errors || typeof b.errors !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(b.errors)) {
    if (Array.isArray(messages) && typeof messages[0] === "string") {
      result[key] = messages[0];
    }
  }
  return result;
}

export type SetPasswordPayload = {
  email: string;
  code: string;
  password: string;
  password_confirmation: string;
};

export type SetPasswordResponse = {
  message: string;
};

export type LoginPayload = {
  email: string;
  password: string;
  device?: string;
};

export function extractAuthTokenFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.token === "string") return b.token;
  if (typeof b.access_token === "string") return b.access_token;
  const data = b.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.token === "string") return d.token;
    if (typeof d.access_token === "string") return d.access_token;
  }
  return null;
}

export type AuthUserPayload = {
  id?: number | string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  role?: string;
};

export function extractUserFromAuthBody(body: unknown): AuthUserPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const fromRecord = (record: Record<string, unknown>): AuthUserPayload | null => {
    const id = record.id;
    const name = record.name;
    const email = record.email;
    const emailVerified = record.email_verified;
    const role = record.role;
    if (id == null && name == null && email == null) return null;
    return {
      id: typeof id === "number" || typeof id === "string" ? id : undefined,
      name: typeof name === "string" ? name : undefined,
      email: typeof email === "string" ? email : undefined,
      email_verified: typeof emailVerified === "boolean" ? emailVerified : undefined,
      role: typeof role === "string" ? role : undefined,
    };
  };

  if (b.user && typeof b.user === "object") {
    const parsed = fromRecord(b.user as Record<string, unknown>);
    if (parsed) return parsed;
  }

  const data = b.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.user && typeof d.user === "object") {
      const parsed = fromRecord(d.user as Record<string, unknown>);
      if (parsed) return parsed;
    }
    const parsed = fromRecord(d);
    if (parsed) return parsed;
  }

  return fromRecord(b);
}

export const CountriesApi = {
  // TODO: GET /countries
  list: async () => ({ data: [] }),
};

export const BundlesApi = {
  // GET /public/bundles — sends Bearer token when present so admins see admin-only SKUs
  list: async <T = unknown>(): Promise<{ data: T }> => {
    const token = getBearerToken();
    if (token) {
      const res = await authFetch(`${PUBLIC_API_BASE}/public/bundles`);
      const body = await parseResponseBody(res);
      if (!res.ok) {
        throw new Error(`Request failed (${res.status}) /public/bundles`);
      }
      return { data: body as T };
    }
    return getJson<T>(`${PUBLIC_API_BASE}/public/bundles`);
  },
};

export const KycApi = {
  // TODO: POST /kyc
  create: async (_data: unknown) => ({ data: {} }),
  // TODO: GET /kyc/get
  get: async () => ({ data: {} }),
};

export const AuthApi = {
  /** GET /me — validate current bearer token and refresh user payload */
  me: async (): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me`);
    return toApiResult(res);
  },
  /** POST /auth/register — body: { name, email, password, device? } */
  register: async (data: { name: string; email: string; password: string }): Promise<RegisterResult> => {
    const res = await fetch(`${PUBLIC_API_BASE}/auth/register`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...data, device: getOrCreateDeviceId() }),
    });
    const body = await parseResponseBody(res);
    return { ok: res.ok, status: res.status, body };
  },
  /** POST /auth/login — body: { email, password, device? } */
  login: async (data: LoginPayload): Promise<ApiResult> => {
    const res = await fetch(`${PUBLIC_API_BASE}/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...data, device: data.device ?? getOrCreateDeviceId() }),
    });
    const body = await parseResponseBody(res);
    return { ok: res.ok, status: res.status, body };
  },
  /** POST /auth/reset-password — walk-in SIM or forgot-password flow */
  resetPassword: async (data: SetPasswordPayload): Promise<ApiResult> => {
    const res = await fetch(`${PUBLIC_API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    const body = await parseResponseBody(res);
    return { ok: res.ok, status: res.status, body };
  },
  /** POST /auth/forgot-password — request a new reset code */
  forgotPassword: async (data: { email: string }): Promise<ApiResult> => {
    const res = await fetch(`${PUBLIC_API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    const body = await parseResponseBody(res);
    return { ok: res.ok, status: res.status, body };
  },
  /** POST /auth/verify-email — body: { email, code } */
  verifyEmail: async (data: { email: string; code: string }): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      auth: Boolean(getBearerToken()),
    });
    return toApiResult(res);
  },
  /** POST /auth/email/resend — resend verification email (auth required) */
  resendVerificationEmail: async (): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/auth/email/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return toApiResult(res);
  },
  /** POST /auth/send-verification-email — body: { email } */
  sendVerificationEmail: async (data: { email: string }): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/auth/send-verification-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return toApiResult(res);
  },
};

export const OrderApi = {
  /** GET /me/orders — list orders for the signed-in user */
  listMine: async (): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me/orders`);
    return toApiResult(res);
  },
  /** POST /orders/{orderId}/evpay-checkout-url — reuse or create the EvMak checkout link */
  evpayCheckoutUrl: async (orderId: string | number): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/orders/${orderId}/evpay-checkout-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return toApiResult(res);
  },
  /** POST /orders */
  create: async (payload: unknown): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return toApiResult(res);
  },
  /** PATCH /me/esims/activation-date — move the eSIM activation date before a number is assigned */
  updateActivationDate: async (payload: {
    activation_date: string;
    order_id?: number;
  }): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me/esims/activation-date`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return toApiResult(res);
  },
  // TODO: GET /orders/:draftId
  getByDraftId: async (_draftId: string) => ({ data: {} }),
  // TODO: POST /preorders/drafts
  createDraft: async (_payload: unknown) => ({ data: {} }),
  // TODO: POST /orders/finalize
  finalize: async (_payload: unknown) => ({ data: {} }),
};

export type EsimAssignmentPayload = {
  id?: number;
  activation_email_sent_at?: string | null;
  esim?: {
    id?: number;
    msisdn?: string | null;
    phone_number?: string | null;
    iccid?: string | null;
    status?: string | null;
    sale_status?: string | null;
    sim_type?: string | null;
    provider_status?: string | null;
    description?: string | null;
    qr_code_data?: string | null;
    has_activation_data?: boolean;
  };
  bundle?: {
    name?: string | null;
    alias?: string | null;
    type?: string | null;
    type_name?: string | null;
    duration?: string | null;
    data_mb?: number | null;
  };
};

export type EsimAssignmentStatus = {
  has_sim: boolean;
  status?: string;
  poll_again?: boolean;
  retry_after_seconds?: number;
  activation_date?: string | null;
  order_id?: number | null;
  inventory?: { available?: number };
  data?: EsimAssignmentPayload;
};

export type EsimActivationData = {
  qr_code_data: string;
  esim?: EsimAssignmentPayload["esim"];
};

export const EsimsApi = {
  /** GET /me/esims — eSIM details for the signed-in user */
  listMine: async (): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me/esims`);
    return toApiResult(res);
  },
  /** GET /me/esims/assignment-status — check whether a SIM has been assigned */
  assignmentStatus: async (): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me/esims/assignment-status`);
    return toApiResult(res);
  },
  /** POST /me/esims/register — assign a free SIM from inventory (auth required) */
  register: async (): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me/esims/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return toApiResult(res);
  },
  /** GET /me/esims/{userEsimId}/activation — qr_code_data for device eSIM install */
  getActivation: async (userEsimId: number): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me/esims/${userEsimId}/activation`);
    return toApiResult(res);
  },
  /** POST /me/esims/{userEsimId}/device-activated — record eSIM installed on device */
  markDeviceActivated: async (userEsimId: number): Promise<ApiResult> => {
    const res = await authFetch(`${PUBLIC_API_BASE}/me/esims/${userEsimId}/device-activated`, {
      method: "POST",
    });
    return toApiResult(res);
  },
  /** GET /me/esims/balance-status — poll until Vodacom balance callback is stored */
  balanceStatus: async (params: { since: string; msisdn?: string }): Promise<ApiResult> => {
    const qs = new URLSearchParams({ since: params.since });
    if (params.msisdn) qs.set("msisdn", params.msisdn);
    const res = await authFetch(`${PUBLIC_API_BASE}/me/esims/balance-status?${qs.toString()}`);
    return toApiResult(res);
  },
};

/** Parse GET /me/esims/{id}/activation response — activation value is `qr_code_data` only. */
export function parseEsimActivation(body: unknown): EsimActivationData | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;

  const qr =
    typeof data.qr_code_data === "string" ? data.qr_code_data.trim() : "";

  if (!qr) return null;

  const esim =
    data.esim && typeof data.esim === "object" && !Array.isArray(data.esim)
      ? (data.esim as EsimAssignmentPayload["esim"])
      : undefined;

  return {
    qr_code_data: qr,
    esim,
  };
}
