export interface Bundle {
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

export type ApiBundle = {
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
  unit?: string | null; // e.g. "GB" | "MB"
  active?: boolean;
};

export type BundlesResponse = { bundles: ApiBundle[] };

export function toMb(bundle: ApiBundle): number | undefined {
  if (typeof bundle.data_mb === 'number') return bundle.data_mb;
  if (typeof bundle.bundle_size_in_mb === 'number') return bundle.bundle_size_in_mb;

  const size = Number(bundle.bundle_size);
  if (!Number.isFinite(size)) return undefined;

  const unit = (bundle.unit ?? '').toUpperCase();
  if (unit === 'GB') return Math.round(size * 1024);
  if (unit === 'MB') return Math.round(size);
  return undefined;
}

export const bundleImages: Record<number, string> = {
  1: '/backgrounds/3.jpg',
  2: '/backgrounds/1.jpg',
  3: '/backgrounds/5.jpg',
};

export function bundleImageFor(id: string | number): string {
  return bundleImages[Number(id)] ?? '/backgrounds/5.jpg';
}

export function formatMb(mb?: number) {
  if (!mb) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

/** Consistent "Internet, 30 days, 25 MB" style label, regardless of how the raw API `name` is formatted. */
export function buildBundleTagline(validityDays?: number | null, mb?: number): string {
  const days = validityDays ?? 30;
  return `Internet, ${days} days, ${formatMb(mb)}`;
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

/** Display labels that override API aliases / raw names. */
export function displayBundleName(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.toLowerCase() === 'nomad+') return 'Nomad plus';
  return trimmed;
}

/** Starter (25 MB) is not offered for purchase — hide it from every catalog. */
export function isHiddenCatalogBundle(bundle: { name?: string; data_mb?: number }): boolean {
  if (bundle.data_mb === 25) return true;
  return (bundle.name ?? '').trim().toLowerCase() === 'starter';
}

export function mapApiBundles(apiBundles: ApiBundle[]): Bundle[] {
  return apiBundles
    .map((b) => {
      const dataMb = toMb(b);
      return {
        id: b.id,
        sim_bundle_id: b.sim_bundle_id ?? null,
        name: displayBundleName(b.alias?.trim() || fallbackBundleName(dataMb) || b.name),
        data_mb: dataMb,
        validity_days: b.validity_days ?? undefined,
        price: b.price ?? undefined,
        currency: b.currency ?? undefined,
        tagline: buildBundleTagline(b.validity_days, dataMb),
      };
    })
    .filter((b) => !isHiddenCatalogBundle(b));
}
