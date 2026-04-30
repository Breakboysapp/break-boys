export function centsToDisplay(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = typeof input === "number" ? input : Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function formatUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Compute per-team retail = (team's valueIndex / sum of valueIndex) * boxPrice.
 * Returns null when boxPrice is unset, total index is zero, or this team has
 * no value index. Manual override always wins when non-null.
 */
export function computeRetailCents(args: {
  valueIndexCents: number | null;
  retailOverrideCents: number | null;
  boxPriceCents: number | null;
  totalIndexCents: number;
}): number | null {
  if (args.retailOverrideCents != null) return args.retailOverrideCents;
  if (args.boxPriceCents == null) return null;
  if (args.totalIndexCents <= 0) return null;
  if (args.valueIndexCents == null || args.valueIndexCents <= 0) return null;
  return Math.round((args.valueIndexCents / args.totalIndexCents) * args.boxPriceCents);
}

export function formatRelativeTime(date: Date | null | undefined): string {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  return `${month}mo ago`;
}
