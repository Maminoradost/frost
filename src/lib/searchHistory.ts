/** История поиска и подсказки. Без сторов и сети, чтобы проверять тестами. */
import { isLink } from './shareLinks';

/** Сколько последних запросов помнить. */
export const HISTORY_LIMIT = 15;

const normalize = (q: string) => q.replace(/\s+/g, ' ').trim();
const same = (a: string, b: string) => normalize(a).toLocaleLowerCase() === normalize(b).toLocaleLowerCase();

/** Стоит ли запоминать: не пустой, не одна буква и не ссылка. */
export function worthRemembering(q: string): boolean {
  const text = normalize(q);
  return text.length >= 2 && !isLink(text);
}

/** Запрос в начало истории, без повторов (регистр не важен). */
export function remember(list: readonly string[], q: string, limit = HISTORY_LIMIT): string[] {
  if (!worthRemembering(q)) return [...list];
  const text = normalize(q);
  return [text, ...list.filter((x) => !same(x, text))].slice(0, limit);
}

export function forget(list: readonly string[], q: string): string[] {
  return list.filter((x) => !same(x, q));
}

/**
 * Подсказки к введённому тексту: сначала свои запросы, которые с него начинаются, потом свои,
 * где он встречается, потом подсказки источника. Сам введённый текст не предлагается.
 */
export function suggestFor(query: string, history: readonly string[], remote: readonly string[], limit = 6): string[] {
  const q = normalize(query).toLocaleLowerCase();
  if (!q || isLink(q)) return [];
  const lower = (s: string) => normalize(s).toLocaleLowerCase();
  const starts = history.filter((h) => lower(h).startsWith(q));
  const contains = history.filter((h) => !lower(h).startsWith(q) && lower(h).includes(q));
  const out: string[] = [];
  for (const s of [...starts, ...contains, ...remote]) {
    const text = normalize(s);
    if (!text || lower(text) === q || out.some((x) => same(x, text))) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}
