/** Format a number for a readout; null/undefined/NaN show as an en dash. */
export function num(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = v.toFixed(decimals);
  // Avoid showing "-0" for tiny negative values.
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** I:E as "1 : x". */
export function ie(ratio: number | null | undefined): string {
  if (!ratio || !Number.isFinite(ratio)) return "–";
  return ratio >= 1 ? `1 : ${ratio.toFixed(1)}` : `${(1 / ratio).toFixed(1)} : 1`;
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
