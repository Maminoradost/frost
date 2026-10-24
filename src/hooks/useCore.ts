import { useEffect } from 'react';
import { engine } from '../audio/engine';
import { IS_ANDROID } from '../lib/platform';
import { initLocalLibrary } from '../store/local';
import { useSettings } from '../store/settings';
import { toast, useUi } from '../store/ui';
import { useAppearance } from './useAppearance';
import { useUpdateCheck } from './useBackground';
import { useListening } from './useIntegrations';
import { useSleepTimer } from './useSleepTimer';

/** Устройство вывода (только Windows) и выравнивание громкости из настроек. */
function useAudioOutput() {
  const device = useSettings((s) => s.outputDevice);
  const normalize = useSettings((s) => s.normalize);
  useEffect(() => {
    // На Android звук идёт туда, куда направит система (динамик, наушники, Bluetooth)
    if (IS_ANDROID) return;
    void engine.setOutputDevice(device).then((ok) => {
      if (!ok && device) toast('Выбранное устройство вывода недоступно, звук идёт в устройство Windows по умолчанию', 'error');
    });
  }, [device]);
  useEffect(() => engine.setNormalize(normalize), [normalize]);
}

/** То, что нужно и окну Windows, и мобильной оболочке: тема, таймер сна, обновления, медиатека. */
export function useCore() {
  useAppearance();
  useSleepTimer();
  useUpdateCheck();
  useAudioOutput();
  useListening();

  useEffect(() => {
    void useSettings.getState().loadConfig();
    useUi.getState().setSearchProvider(useSettings.getState().searchSource);
    void initLocalLibrary();
    // Системное меню WebView («Обновить», «Проверить элемент») скрываем везде, кроме полей ввода.
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('input, textarea')) e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    // Интерфейс готов: убираем заставку (index.html), выдержав её минимальную длительность
    window.requestAnimationFrame(() => window.__frostSplashDone?.());
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);
}
