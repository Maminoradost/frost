import { useEffect, useState } from 'react';
import { systemAccent } from '../lib/android';
import { IS_ANDROID } from '../lib/platform';

/**
 * Цвет из обоев Android 12+ (Material You) или null. Перечитывается, когда Frost снова на
 * экране: обои могли поменять, пока он был в фоне. `enabled = false`: ничего не запрашивает.
 */
export function useWallpaperColor(enabled = true): string | null {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (!IS_ANDROID || !enabled) {
      setColor(null);
      return;
    }
    let alive = true;
    const read = () => {
      void systemAccent().then((c) => {
        if (alive) setColor(c);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    read();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
  return color;
}
