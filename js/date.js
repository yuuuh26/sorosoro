const DAY_MS = 86400000;

export function toDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function addInterval(dateKey, value, unit) {
  const date = parseDateKey(dateKey);
  if (unit === 'day') date.setDate(date.getDate() + value);
  if (unit === 'week') date.setDate(date.getDate() + value * 7);
  if (unit === 'month') {
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + value);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(originalDay, lastDay));
  }
  return toDateKey(date);
}

export function calendarDayDiff(fromKey, toKey) {
  return Math.round((parseDateKey(toKey) - parseDateKey(fromKey)) / DAY_MS);
}

export function formatDate(dateKey, includeYear = false) {
  if (!dateKey) return '記録なし';
  const options = includeYear ? { year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('ja-JP', options).format(parseDateKey(dateKey));
}

export function formatLongDate(dateKey) {
  if (!dateKey) return '記録なし';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(parseDateKey(dateKey));
}

export function getDueState(item, today = toDateKey()) {
  const diff = calendarDayDiff(today, item.nextDueDate);
  if (diff < 0) return { key: 'overdue', rank: 0, diff, label: `${Math.abs(diff)}日過ぎています` };
  if (diff === 0) return { key: 'today', rank: 1, diff, label: '今日です' };
  if (diff <= Number(item.riseDays || 0)) return { key: 'soon', rank: 2, diff, label: `あと${diff}日` };
  return { key: 'safe', rank: 3, diff, label: `あと${diff}日` };
}

export function intervalLabel(item) {
  return `${item.intervalValue}${{ day: '日', week: '週', month: 'か月' }[item.intervalUnit]}ごと`;
}
