import * as chrono from 'chrono-node';

const DAY = 864e5;

/** UTC offset (minutes) of an IANA timezone at a given instant. */
export function offsetMin(tz: string, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Resolve a past day the user refers to ("3 November", "last Tuesday", "on Monday").
 * Returns [from, to) windows of local days in epoch ms (empty if none).
 * Memory is past-only, so a date that lands in the future is rolled back.
 * "last Tuesday" is ambiguous (most recent Tuesday, or the one a week ago), so both are returned.
 */
export function resolveDay(text: string, now: Date, tz: string) {
  const off = offsetMin(tz, now);
  const r = chrono.parse(text, { instant: now, timezone: off })[0];
  if (!r) return [];
  const y = r.start.get('year')!, m = r.start.get('month')!, d = r.start.get('day')!;
  let from = Date.UTC(y, m - 1, d) - off * 60000;
  if (from > now.getTime()) {
    from = r.start.isCertain('weekday') && !r.start.isCertain('day')
      ? from - 7 * DAY
      : Date.UTC(y - 1, m - 1, d) - off * 60000;
  }
  const days = [from];
  if (/\blast\s+(mon|tue|wed|thu|fri|sat|sun)/i.test(r.text) && now.getTime() - from < 7 * DAY) days.push(from - 7 * DAY);
  return days.sort((a, b) => a - b).map((f) => ({ from: f, to: f + DAY }));
}
