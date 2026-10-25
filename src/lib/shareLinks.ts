/**
 * Ссылки, которыми делятся с Frost или по которым его открывают (Android: «Поделиться» и переход
 * по ссылке). Без зависимостей от Tauri и сторов, чтобы проверять тестами.
 */

/** Ссылка, которую понимает `api.resolveUrl`: SoundCloud, YouTube, YouTube Music. */
const SUPPORTED = /^https?:\/\/(?:(?:www\.|m\.|on\.)?soundcloud\.com\/|(?:www\.|m\.|music\.)?youtube\.com\/|youtu\.be\/)/i;

/** Похожа ли строка на ссылку (поиск показывает для неё результат «По ссылке»). */
export function isLink(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

export function isSupportedLink(url: string): boolean {
  return SUPPORTED.test(url.trim());
}

/**
 * Первая ссылка из текста. Приложения делятся по-разному: YouTube Music присылает голую ссылку,
 * SoundCloud пишет «Послушайте … на #SoundCloud» и ссылку в конце.
 */
export function extractLink(text: string | null | undefined): string | null {
  if (!text) return null;
  const all = text.match(/https?:\/\/[^\s<>"']+/gi);
  if (!all) return null;
  const url = (all.find(isSupportedLink) ?? all[0]).replace(/[.,;:!?)\]»”]+$/u, '');
  return url || null;
}

/** Убирает метки отслеживания (`si`, `utm_*`, `feature`), чтобы ссылка в поиске была короче. */
export function cleanLink(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (key === 'si' || key === 'feature' || key === 'pp' || key.startsWith('utm_') || key === 'ref') u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url;
  }
}
