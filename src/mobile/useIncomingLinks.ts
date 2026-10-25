import { useEffect } from 'react';
import { api } from '../lib/api';
import { onNative, takeLaunchLink } from '../lib/android';
import { cleanLink, extractLink, isSupportedLink } from '../lib/shareLinks';
import { IS_ANDROID } from '../lib/platform';
import { usePlayer } from '../store/player';
import { toast, useUi } from '../store/ui';

/**
 * Открыть ссылку, которой поделились с Frost или по которой его открыли: трек сразу играет,
 * плейлист, альбом и исполнитель открываются страницей. Если не вышло, ссылка остаётся в
 * поиске: там видна причина и есть «Повторить».
 */
export async function openSharedLink(text: string): Promise<void> {
  const found = extractLink(text);
  if (!found) {
    toast('В том, чем поделились, нет ссылки', 'error');
    return;
  }
  if (!isSupportedLink(found)) {
    toast('Frost открывает ссылки YouTube, YouTube Music и SoundCloud', 'error');
    return;
  }
  const url = cleanLink(found);
  const ui = useUi.getState();
  const showInSearch = () => {
    ui.setSearchQuery(url);
    ui.navigate({ name: 'search' });
  };
  try {
    const target = await api.resolveUrl(url);
    if (target?.track) {
      usePlayer.getState().playList([target.track], 0, 'По ссылке');
      showInSearch();
    } else if (target?.playlist) {
      ui.navigate({ name: 'playlist', provider: target.playlist.provider, id: target.playlist.id });
    } else if (target?.artist) {
      ui.navigate({ name: 'artist', provider: target.artist.provider, id: target.artist.id });
    } else {
      showInSearch();
    }
  } catch (e) {
    console.warn('Ссылка не открылась', e);
    showInSearch();
  }
}

/** Android: ссылки из «Поделиться» и переходы по ссылкам YouTube Music / SoundCloud. */
export function useIncomingLinks() {
  useEffect(() => {
    if (!IS_ANDROID) return;
    let alive = true;
    void takeLaunchLink().then((url) => {
      if (alive && url) void openSharedLink(url);
    });
    const listener = onNative<{ url?: string }>('link', (payload) => {
      if (payload?.url) void openSharedLink(payload.url);
    });
    return () => {
      alive = false;
      void listener.then((l) => l?.unregister());
    };
  }, []);
}
