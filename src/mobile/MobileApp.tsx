import { Suspense, useEffect } from 'react';
import { ContextMenu } from '../components/ContextMenu';
import { ModalHost } from '../components/Modals';
import { Onboarding } from '../components/Onboarding';
import { Spinner } from '../components/States';
import { Toasts } from '../components/Toasts';
import { useCore } from '../hooks/useCore';
import { getInsets, onNative, type Insets } from '../lib/android';
import { RouteView } from '../RouteView';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { BottomNav } from './BottomNav';
import { MiniPlayer } from './MiniPlayer';
import { MobileNowPlaying } from './MobileNowPlaying';
import { MobileTopBar } from './MobileTopBar';
import { useBackButton } from './useBackButton';

/** Оболочка для телефона: верхняя панель, страница, мини-плеер и нижняя навигация. */
export function MobileApp() {
  const route = useUi((s) => s.route);
  const hasTrack = usePlayer((s) => s.current !== null);
  useCore();
  useBackButton();
  useSystemInsets();

  return (
    <div className={`app app--mobile ${hasTrack ? 'has-track' : ''}`}>
      <MobileTopBar />
      <main className="main m-main" id="main" tabIndex={-1}>
        <div className="main__scroll" key={JSON.stringify(route)}>
          <Suspense
            fallback={
              <div className="page-loading" role="status" aria-label="Загрузка">
                <Spinner />
              </div>
            }
          >
            <RouteView route={route} />
          </Suspense>
        </div>
      </main>
      <MiniPlayer />
      <BottomNav />
      <MobileNowPlaying />
      <ContextMenu />
      <ModalHost />
      <Onboarding />
      <Toasts />
    </div>
  );
}

/**
 * Отступы под строку состояния, панель навигации и клавиатуру (Android рисует Frost от края до края).
 * Плагин сам кладёт их в CSS, но до загрузки страницы это может потеряться: дублируем из JS.
 * Клавиатура: если WebView уже уменьшилась сама, второй отступ не добавляем.
 */
function useSystemInsets() {
  useEffect(() => {
    const root = document.documentElement;
    let ime = 0;
    let baseHeight = window.innerHeight;

    const applyIme = () => {
      const shrunk = Math.max(0, baseHeight - window.innerHeight);
      const pad = ime > 0 && shrunk < ime / 2 ? ime : 0;
      root.style.setProperty('--m-ime', `${pad}px`);
      if (ime > 0) root.dataset.ime = 'open';
      else delete root.dataset.ime;
    };
    const apply = (i: Insets | null) => {
      if (!i) return;
      root.style.setProperty('--frost-inset-top', `${i.top}px`);
      root.style.setProperty('--frost-inset-bottom', `${i.bottom}px`);
      root.style.setProperty('--frost-inset-left', `${i.left}px`);
      root.style.setProperty('--frost-inset-right', `${i.right}px`);
      if (i.ime === 0 && ime === 0) baseHeight = window.innerHeight;
      ime = i.ime;
      applyIme();
    };
    const onResize = () => {
      if (ime === 0) baseHeight = window.innerHeight;
      applyIme();
    };

    let alive = true;
    let unregister: (() => void) | undefined;
    void getInsets().then((i) => alive && apply(i));
    void onNative<Insets>('insets', apply).then((listener) => {
      if (!listener) return;
      if (alive) unregister = () => void listener.unregister();
      else void listener.unregister();
    });
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      unregister?.();
      window.removeEventListener('resize', onResize);
    };
  }, []);
}
