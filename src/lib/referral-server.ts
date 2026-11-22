import 'server-only';

export const REFERRAL_COOKIE = 'travela_referral';
export const referralCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 30 * 24 * 60 * 60,
};

export function normalizeReferral(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase().replace(/^TRV-/, '');
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

export async function resolveReferral(code: string): Promise<string | null> {
  const normalized = normalizeReferral(code);
  if (!normalized) return null;
  const base = (
    process.env.REFERRAL_API_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    'http://127.0.0.1:8000/api'
  ).replace(/\/+$/, '');
  const response = await fetch(
    `${base}/public/partner-referrals/${encodeURIComponent(normalized)}`,
    {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Referral validation unavailable');
  const data = await response.json();
  return normalizeReferral(data?.referral?.code) === normalized ? normalized : null;
}
