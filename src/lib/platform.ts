/**
 * Платформа Frost: Windows (полный десктоп) или Android (мобильная оболочка).
 *
 * Определяется синхронно по WebView, чтобы `data-platform` стоял на <html>
 * ещё до первого рендера и мобильная раскладка не «мигала».
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export const IS_ANDROID = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
export const IS_DESKTOP = !IS_ANDROID;

/** Подписи, которые зависят от устройства. */
export const DEVICE_FILES_LABEL = IS_ANDROID ? 'На телефоне' : 'На компьютере';
export const SYSTEM_THEME_LABEL = IS_ANDROID ? 'Как в системе' : 'Как в Windows';

if (IS_ANDROID && typeof document !== 'undefined') document.documentElement.dataset.platform = 'android';

let mediaBase: string | null = null;

/** Узнаёт адрес локального аудиосервера (только Android). Ждёт не дольше полутора секунд. */
export async function initPlatform(): Promise<void> {
  if (!IS_ANDROID) return;
  try {
    const base = await Promise.race([
      invoke<string>('media_base'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (typeof base === 'string' && base.startsWith('http://127.0.0.1')) mediaBase = base;
  } catch {
    mediaBase = null;
  }
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Адрес локального аудиофайла для <audio> и чтения тегов (запросы с Range).
 * На Android идёт через локальный HTTP-сервер: WebView ломает Range у asset:// (wry#1864).
 */
export function localMediaUrl(path: string): string {
  if (IS_ANDROID && mediaBase) return `${mediaBase}l/${base64Url(path)}`;
  return convertFileSrc(path);
}
