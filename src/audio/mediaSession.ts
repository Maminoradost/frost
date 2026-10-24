import { clearSession, onNative, updateSession, type MediaAction } from '../lib/android';
import { IS_ANDROID } from '../lib/platform';
import type { Track } from '../lib/types';
import { engine } from './engine';

/**
 * Media Session API → системная панель мультимедиа Windows (SMTC) и медиаклавиши.
 * WebView2 транслирует метаданные и действия в SMTC.
 *
 * На Android WebView этого не делает, поэтому то же состояние уходит в нативную
 * MediaSession плагина frost-mobile: уведомление, экран блокировки, гарнитура, Bluetooth.
 */
const supported = !IS_ANDROID && typeof navigator !== 'undefined' && 'mediaSession' in navigator;

// ---------- Android ----------

const native = { track: null as Track | null, playing: false };
let nativeTimer = 0;
let nativeShown = false;

/** Отправляет снимок состояния плагину. Частые вызовы склеиваются в один. */
function syncNative() {
  if (!IS_ANDROID) return;
  window.clearTimeout(nativeTimer);
  nativeTimer = window.setTimeout(() => {
    const t = native.track;
    if (!t) {
      if (nativeShown) clearSession();
      nativeShown = false;
      return;
    }
    // Уведомление появляется с первым воспроизведением, а не при запуске с прошлым треком на паузе
    if (!nativeShown && !native.playing) return;
    const engineDuration = engine.duration;
    const duration = Number.isFinite(engineDuration) && engineDuration > 0 ? engineDuration : t.duration > 0 ? t.duration : null;
    nativeShown = true;
    updateSession({
      title: t.title,
      artist: t.artist,
      album: t.album ?? '',
      artwork: t.artwork ?? t.artworkSmall ?? null,
      duration,
      position: Math.max(0, engine.currentTime || 0),
      playing: native.playing,
      rate: 1,
      hasNext: true,
      hasPrevious: true,
    });
  }, 60);
}

// Система сама продвигает позицию, пока идёт воспроизведение; раз в 15 секунд сверяемся,
// чтобы ползунок на экране блокировки не убегал после подгрузки сети.
if (IS_ANDROID) {
  window.setInterval(() => {
    if (native.track && native.playing) syncNative();
  }, 15_000);
}

export function updateMediaMetadata(track: Track | null) {
  if (IS_ANDROID) {
    native.track = track;
    syncNative();
    return;
  }
  if (!supported) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const artwork: MediaImage[] = [];
  if (track.artworkSmall) artwork.push({ src: track.artworkSmall, sizes: '150x150' });
  if (track.artwork) artwork.push({ src: track.artwork, sizes: '500x500' });
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? '',
    artwork,
  });
}

export function setPlaybackState(playing: boolean) {
  if (IS_ANDROID) {
    native.playing = playing;
    syncNative();
    return;
  }
  if (!supported) return;
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

export function setPositionState(position: number, duration: number) {
  if (IS_ANDROID) {
    syncNative();
    return;
  }
  if (!supported || !(duration > 0) || !Number.isFinite(duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(0, position), duration),
      playbackRate: 1,
    });
  } catch {
    /* игнорируем некорректные значения */
  }
}

export interface MediaHandlers {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (time: number) => void;
  seekBy: (delta: number) => void;
}

export function bindMediaActions(h: MediaHandlers) {
  if (IS_ANDROID) {
    void onNative<{ action: MediaAction; position?: number }>('media', ({ action, position }) => {
      if (action === 'play') h.play();
      else if (action === 'pause') h.pause();
      else if (action === 'next') h.next();
      else if (action === 'previous') h.prev();
      else if (action === 'seek' && position != null) h.seekTo(position);
    });
    return;
  }
  if (!supported) return;
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* действие не поддерживается */
    }
  };
  set('play', () => h.play());
  set('pause', () => h.pause());
  set('stop', () => h.pause());
  set('nexttrack', () => h.next());
  set('previoustrack', () => h.prev());
  set('seekto', (d) => {
    if (d.seekTime != null) h.seekTo(d.seekTime);
  });
  set('seekbackward', (d) => h.seekBy(-(d.seekOffset ?? 10)));
  set('seekforward', (d) => h.seekBy(d.seekOffset ?? 10));
}
