export const PLAN_VALIDITY_DAYS = 30;

/**
 * After the current/last 30-day data plan ends, the number stays open for top-ups
 * for this many more days. No top-up in that window → number expires.
 */
export const NUMBER_GRACE_DAYS = 90;

/** Activation dates are calendar dates in Tanzania, wherever the customer is. */
export function activationToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function toDatePart(iso?: string | null): string | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/** Add calendar days in UTC without depending on the browser's timezone or DST. */
export function addUtcDays(datePart: string, days: number): string {
  const date = new Date(`${datePart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Add thirty UTC days without depending on the browser's timezone or DST. */
export function plannedExpiryDate(activationDate: string): string {
  return addUtcDays(activationDate, PLAN_VALIDITY_DAYS);
}

export function hasPlanExpired(expiresAt?: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && now >= expiry;
}

/**
 * Last day of the current/last data plan.
 * Prefer plan_expires_at (moves forward with each top-up). Fallback: start + 30 days.
 */
export function lastPlanEndDate(
  planExpiresAt?: string | null,
  planStartedAt?: string | null
): string | null {
  const fromExpiry = toDatePart(planExpiresAt);
  if (fromExpiry) return fromExpiry;
  const start = toDatePart(planStartedAt);
  return start ? plannedExpiryDate(start) : null;
}

/**
 * Number window ends NUMBER_GRACE_DAYS after the last plan ends.
 * Top-ups are allowed until that day; after it, the customer needs a new eSIM.
 */
export function numberExpiryDate(
  planExpiresAt?: string | null,
  planStartedAt?: string | null
): string | null {
  const planEnd = lastPlanEndDate(planExpiresAt, planStartedAt);
  if (!planEnd) return null;
  return addUtcDays(planEnd, NUMBER_GRACE_DAYS);
}

/** True once today (Tanzania calendar) reaches the day 90 days after the last plan end. */
export function hasNumberExpired(
  planExpiresAt?: string | null,
  planStartedAt?: string | null,
  now = new Date()
): boolean {
  const expiryDay = numberExpiryDate(planExpiresAt, planStartedAt);
  if (!expiryDay) return false;
  return activationToday(now) >= expiryDay;
}
