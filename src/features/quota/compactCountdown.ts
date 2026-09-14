/**
 * "2h 05m" / "3d 4h" / "45m" — the short countdown used by quota cells and
 * the burning chip. Minute resolution; anything under a minute is "<1m".
 */
export function formatCompactCountdown(targetMs: number, nowMs: number): string {
  const totalMinutes = Math.max(0, Math.round((targetMs - nowMs) / 60_000));
  if (totalMinutes < 1) return '<1m';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}
