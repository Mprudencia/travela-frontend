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
