import { lazy, Suspense } from 'react';
import { Ambient } from './components/Ambient';
import { ContextMenu } from './components/ContextMenu';
import { ModalHost } from './components/Modals';
import { NowPlaying } from './components/NowPlaying';
import { Onboarding } from './components/Onboarding';
import { PlayerBar } from './components/PlayerBar';
import { SidePanel } from './components/SidePanel';
import { Sidebar } from './components/Sidebar';
import { Spinner } from './components/States';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { useYtdlpBootstrap, useYtdlpSchedule } from './hooks/useBackground';
import { useCore } from './hooks/useCore';
import { useDesktop } from './hooks/useDesktop';
import { useDiscordPresence } from './hooks/useIntegrations';
import { useShortcuts } from './hooks/useShortcuts';
import { IS_ANDROID } from './lib/platform';
import { RouteView } from './RouteView';
import { useUi } from './store/ui';

// Мобильная оболочка отдельным куском: окну Windows она не нужна
const MobileApp = lazy(() => import('./mobile/MobileApp').then((m) => ({ default: m.MobileApp })));

export default function App() {
  if (IS_ANDROID) {
    return (
      <Suspense fallback={null}>
        <MobileApp />
      </Suspense>
    );
  }
  return <DesktopApp />;
}

/** Окно Windows: заголовок, боковая панель, плавающий плеер. */
function DesktopApp() {
  const route = useUi((s) => s.route);
  useCore();
  useShortcuts();
  useYtdlpBootstrap();
  useYtdlpSchedule();
  useDesktop();
  useDiscordPresence();

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <Ambient />
      <TitleBar />
      <div className="app__body">
        <Sidebar />
        <main className="main" id="main" tabIndex={-1}>
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
        <SidePanel />
      </div>
      <PlayerBar />
      <NowPlaying />
      <ContextMenu />
      <ModalHost />
      <Onboarding />
      <Toasts />
    </div>
  );
}
