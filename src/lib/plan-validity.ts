export const PLAN_VALIDITY_DAYS = 30;

/** Activation dates are calendar dates in Tanzania, wherever the customer is. */
export function activationToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Add thirty UTC days without depending on the browser's timezone or DST. */
export function plannedExpiryDate(activationDate: string): string {
  const date = new Date(`${activationDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + PLAN_VALIDITY_DAYS);
  return date.toISOString().slice(0, 10);
}

export function hasPlanExpired(expiresAt?: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && now >= expiry;
}

/**
 * Number window ends 30 calendar days after activation (plan_started_at).
 * Top-ups are allowed inside that window; after it, the customer needs a new eSIM.
 */
export function numberExpiryDate(planStartedAt?: string | null): string | null {
  if (!planStartedAt) return null;
  const day = planStartedAt.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return plannedExpiryDate(day);
  const parsed = Date.parse(planStartedAt);
  if (!Number.isFinite(parsed)) return null;
  return plannedExpiryDate(new Date(parsed).toISOString().slice(0, 10));
}

/** True once today (Tanzania calendar) reaches the day 30 days after activation. */
export function hasNumberExpired(planStartedAt?: string | null, now = new Date()): boolean {
  const expiryDay = numberExpiryDate(planStartedAt);
  if (!expiryDay) return false;
  return activationToday(now) >= expiryDay;
}
