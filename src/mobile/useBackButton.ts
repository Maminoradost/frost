import { useEffect } from 'react';
import { minimizeApp, onNative } from '../lib/android';
import { useUi } from '../store/ui';
import { openTab, useMobile } from './store';

/**
 * Системная кнопка (жест) «Назад», по порядку: закрыть окно или меню, вернуть обложку
 * в «Сейчас играет», свернуть его, шаг назад по истории, на главную, свернуть приложение.
 * Музыка при этом не останавливается.
 */
export function handleBack() {
  const ui = useUi.getState();
  if (ui.modal) return ui.closeModal();
  if (ui.menu) return ui.closeMenu();
  // Знакомство и меню таймера сна закрываются по Escape: отдаём им его
  if (document.querySelector('.tour, .sleep-menu')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return;
  }
  if (ui.nowPlaying) {
    const mobile = useMobile.getState();
    if (mobile.npView !== 'art') return mobile.setNpView('art');
    return ui.setNowPlaying(false);
  }
  if (ui.back.length > 0) return ui.goBack();
  if (ui.route.name !== 'home') return openTab('home');
  minimizeApp();
}

export function useBackButton() {
  useEffect(() => {
    let alive = true;
    let unregister: (() => void) | undefined;
    void onNative('back', () => handleBack()).then((listener) => {
      if (!listener) return;
      if (alive) unregister = () => void listener.unregister();
      else void listener.unregister();
    });
    return () => {
      alive = false;
      unregister?.();
    };
  }, []);
}
