export function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

export function percentageOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1_000) / 10;
}
