/**
 * Мост к нативной части Android (плагин `frost-mobile`, Kotlin).
 * На Windows все функции ничего не делают.
 */
import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { IS_ANDROID } from './platform';

const PLUGIN = 'frost-mobile';

function call<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(`plugin:${PLUGIN}|${command}`, args);
}

export interface NativeSession {
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  /** Секунды, null если неизвестно (прямой эфир, ещё грузится). */
  duration: number | null;
  /** Секунды. */
  position: number;
  playing: boolean;
  rate: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export type MediaAction = 'play' | 'pause' | 'next' | 'previous' | 'seek';

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
  ime: number;
}

export function updateSession(session: NativeSession): void {
  if (!IS_ANDROID) return;
  void call('update_session', { ...session }).catch(() => {});
}

export function clearSession(): void {
  if (!IS_ANDROID) return;
  void call('clear_session').catch(() => {});
}

export function onNative<T>(event: string, handler: (payload: T) => void): Promise<PluginListener | null> {
  if (!IS_ANDROID) return Promise.resolve(null);
  return addPluginListener<T>(PLUGIN, event, handler).catch(() => null);
}

export async function getInsets(): Promise<Insets | null> {
  if (!IS_ANDROID) return null;
  return call<Insets>('get_insets').catch(() => null);
}

/** light: светлая тема интерфейса, значит тёмные значки в строке состояния. */
export function setSystemBars(light: boolean): void {
  if (!IS_ANDROID) return;
  void call('set_system_bars', { light }).catch(() => {});
}

/** Свернуть приложение (на корне истории «Назад» не закрывает Frost, музыка играет дальше). */
export function minimizeApp(): void {
  if (!IS_ANDROID) return;
  void call('minimize').catch(() => {});
}

export function keepScreenOn(enabled: boolean): void {
  if (!IS_ANDROID) return;
  void call('keep_screen_on', { enabled }).catch(() => {});
}

export async function requestAudioPermission(): Promise<boolean> {
  if (!IS_ANDROID) return true;
  const result = await call<{ granted?: boolean }>('request_audio_permission').catch(() => null);
  return !!result?.granted;
}

/** Системный выбор папки. path = null, если папка не на обычном диске (например, облако). */
export async function pickFolder(): Promise<{ path: string | null } | null> {
  if (!IS_ANDROID) return null;
  const result = await call<{ path?: string; uri?: string }>('pick_folder');
  if (!result?.uri) return null;
  return { path: result.path ?? null };
}

export async function shareText(text: string, title?: string): Promise<boolean> {
  if (!IS_ANDROID) return false;
  return call('share', { text, title: title ?? null })
    .then(() => true)
    .catch(() => false);
}

/**
 * Системный диалог «Сохранить как»: файл ляжет туда, куда выберет пользователь
 * (Загрузки, Google Диск и т. п.). false: пользователь передумал.
 */
export async function saveDocument(name: string, contents: string, mime = 'application/json'): Promise<boolean> {
  if (!IS_ANDROID) return false;
  const r = await call<{ saved?: boolean }>('save_document', { name, mime, contents });
  return !!r?.saved;
}

export interface NativeInfo {
  sdk: number;
  release: string;
  model: string;
  manufacturer: string;
  abi: string;
  versionName: string;
}

export async function nativeInfo(): Promise<NativeInfo | null> {
  if (!IS_ANDROID) return null;
  return call<NativeInfo>('native_info').catch(() => null);
}

/** Ссылка, с которой запустили Frost («Поделиться» или переход по ссылке). Отдаётся один раз. */
export async function takeLaunchLink(): Promise<string | null> {
  if (!IS_ANDROID) return null;
  const result = await call<{ url?: string }>('take_link').catch(() => null);
  return result?.url ?? null;
}

export type HapticKind = 'long' | 'tick' | 'confirm';
let lastHaptic = 0;

/**
 * Короткий отклик вибромотора (долгое нажатие, смена трека жестом). Учитывает системную
 * настройку «Виброотклик». На компьютере ничего не делает.
 */
export function haptic(kind: HapticKind = 'long'): void {
  if (!IS_ANDROID) return;
  const now = Date.now();
  // Серия жестов не должна превращаться в дребезг
  if (now - lastHaptic < 80) return;
  lastHaptic = now;
  void call('haptic', { kind }).catch(() => {});
}

/**
 * Голосовой поиск через системное окно распознавания речи. null: пользователь закрыл окно
 * или ничего не сказал. Ошибка: на телефоне нет распознавания речи.
 */
export async function voiceSearch(prompt?: string): Promise<string | null> {
  if (!IS_ANDROID) return null;
  const result = await call<{ text?: string }>('voice_search', { prompt: prompt ?? null });
  const text = result?.text?.trim();
  return text ? text : null;
}

/** Android 12+: цвет из обоев (системная палитра Material You), `#rrggbb`. null на старых версиях. */
export async function systemAccent(): Promise<string | null> {
  if (!IS_ANDROID) return null;
  const result = await call<{ color?: string }>('system_accent').catch(() => null);
  return result?.color && /^#[0-9a-f]{6}$/i.test(result.color) ? result.color : null;
}
