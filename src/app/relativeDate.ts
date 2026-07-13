/** Pure date labels for the dashboard (Feature C) — no date libraries.
 *  "Today at 9:55 AM" for the current calendar day, else
 *  "June 3rd 2024, 5:46 PM". Month names are hard-coded English so tests and
 *  CI never depend on the host locale. `now` is injectable for tests. */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function formatDiagramDate(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const h12 = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  const time = `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `Today at ${time}`;
  return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())} ${d.getFullYear()}, ${time}`;
}
