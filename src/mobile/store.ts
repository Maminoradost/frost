import { create } from 'zustand';
import type { Route } from '../store/ui';
import { useUi } from '../store/ui';

/** Разделы нижней панели навигации. */
export type TabKey = 'home' | 'search' | 'library' | 'settings';

/** Что показывает экран «Сейчас играет»: обложку, текст или очередь. */
export type NpView = 'art' | 'lyrics' | 'queue';

interface MobileState {
  /** Раздел, к которому относится текущая страница (для страниц артиста и плейлиста — откуда пришли). */
  lastTab: TabKey;
  npView: NpView;
  setLastTab: (tab: TabKey) => void;
  setNpView: (view: NpView) => void;
}

export const useMobile = create<MobileState>()((set) => ({
  lastTab: 'home',
  npView: 'art',
  setLastTab: (lastTab) => set({ lastTab }),
  setNpView: (npView) => set({ npView }),
}));

const TAB_ROUTES: Record<TabKey, Route> = {
  home: { name: 'home' },
  search: { name: 'search' },
  library: { name: 'library' },
  settings: { name: 'settings' },
};

/** Раздел, которому принадлежит страница, или null для общих страниц (артист, плейлист, жанр). */
export function tabOfRoute(route: Route): TabKey | null {
  switch (route.name) {
    case 'home':
      return 'home';
    case 'search':
      return 'search';
    case 'settings':
      return 'settings';
    case 'library':
    case 'liked':
    case 'local':
    case 'local-playlist':
    case 'wrapped':
      return 'library';
    default:
      return null;
  }
}

/** Корневая страница раздела: на ней вместо стрелки «Назад» показывается логотип. */
export function isTabRoot(route: Route): boolean {
  return route.name === 'home' || route.name === 'search' || route.name === 'settings' || route.name === 'library';
}

/** Прокрутка текущей страницы наверх. */
export function scrollPageToTop() {
  document.querySelector('.m-main .main__scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Переход в раздел нижней панели. Как принято в Android: история раздела не копится,
 * «Назад» из любого раздела ведёт на главную, а с главной сворачивает приложение.
 * Повторное касание активного раздела возвращает к его началу.
 */
export function openTab(tab: TabKey) {
  const ui = useUi.getState();
  const current = tabOfRoute(ui.route) ?? useMobile.getState().lastTab;
  if (current === tab && isTabRoot(ui.route) && ui.route.name === TAB_ROUTES[tab].name) {
    scrollPageToTop();
    if (tab === 'search') document.getElementById('global-search')?.focus();
    return;
  }
  useUi.setState({
    route: TAB_ROUTES[tab],
    back: tab === 'home' ? [] : [TAB_ROUTES.home],
    forward: [],
    nowPlaying: false,
    menu: null,
  });
  useMobile.getState().setLastTab(tab);
}
