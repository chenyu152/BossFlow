import type { ParsedLog } from './types';

export function parseLog(line: string): ParsedLog {
  const match = line.match(/^\[(.*?)\]\s*(.*)$/);
  const time = match?.[1] || '';
  const msg = match?.[2] || line;
  const lower = msg.toLowerCase();
  const level = lower.includes('traceback') || lower.includes('error') || lower.includes('failed')
    ? 'error'
    : lower.includes('warn') || lower.includes('等待') || lower.includes('warning')
      ? 'warn'
      : 'info';

  return { time, level, msg, raw: line };
}

export function hasCity(citiesText: string, name: string) {
  return citiesText.split(/\r?\n/).some((line) => {
    const city = line.trim().split('=')[0]?.trim();
    return city === name;
  });
}

export function toggleCity(citiesText: string, city: { name: string; code: string }) {
  const lines = citiesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const next = lines.filter((line) => line.split('=')[0]?.trim() !== city.name);
  if (next.length === lines.length) next.push(`${city.name}=${city.code}`);
  return next.join('\n');
}
