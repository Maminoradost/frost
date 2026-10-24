import { House, Library, Search, Settings, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useUi } from '../store/ui';
import { openTab, tabOfRoute, useMobile, type TabKey } from './store';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'home', label: 'Главная', icon: House },
  { key: 'search', label: 'Поиск', icon: Search },
  { key: 'library', label: 'Медиатека', icon: Library },
  { key: 'settings', label: 'Настройки', icon: Settings },
];

/** Панель навигации Material 3: четыре раздела, активный отмечен «таблеткой» за значком. */
export function BottomNav() {
  const route = useUi((s) => s.route);
  const lastTab = useMobile((s) => s.lastTab);
  const routeTab = tabOfRoute(route);
  const active = routeTab ?? lastTab;

  useEffect(() => {
    if (routeTab) useMobile.getState().setLastTab(routeTab);
  }, [routeTab]);

  return (
    <nav className="m-nav" aria-label="Разделы">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          className={`m-nav__item ${active === key ? 'is-active' : ''}`}
          aria-current={active === key ? 'page' : undefined}
          data-tour={key === 'home' ? undefined : key}
          onClick={() => openTab(key)}
        >
          <span className="m-nav__icon">
            <Icon size={22} strokeWidth={active === key ? 2.4 : 2} />
          </span>
          <span className="m-nav__label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
