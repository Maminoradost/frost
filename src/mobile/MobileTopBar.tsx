import { ArrowLeft, Search, X } from 'lucide-react';
import { Logo } from '../components/Logo';
import { DEVICE_FILES_LABEL } from '../lib/platform';
import { useUi, type Route } from '../store/ui';
import { isTabRoot, openTab } from './store';

function titleOf(route: Route): string {
  switch (route.name) {
    case 'liked':
      return 'Любимые треки';
    case 'local':
      return DEVICE_FILES_LABEL;
    case 'local-playlist':
    case 'playlist':
      return 'Плейлист';
    case 'artist':
      return 'Исполнитель';
    case 'genre':
      return route.title || 'Подборка';
    case 'wrapped':
      return 'Итоги';
    default:
      return 'Frost';
  }
}

/** Верхняя панель: логотип в корне раздела, стрелка «Назад» на вложенных страницах, поле в поиске. */
export function MobileTopBar() {
  const route = useUi((s) => s.route);
  const canBack = useUi((s) => s.back.length > 0);
  const root = isTabRoot(route);

  const back = () => {
    if (canBack) useUi.getState().goBack();
    else openTab('home');
  };

  return (
    <header className="m-top" data-route={route.name}>
      {root ? (
        <span className="m-top__logo" aria-hidden>
          <Logo size={24} />
        </span>
      ) : (
        <button className="icon-btn m-top__back" onClick={back} aria-label="Назад">
          <ArrowLeft size={22} />
        </button>
      )}
      {route.name === 'search' ? <MobileSearchField /> : <span className="m-top__title">{titleOf(route)}</span>}
    </header>
  );
}

/** Поле поиска (то же состояние, что у поля в заголовке окна Windows). */
function MobileSearchField() {
  const query = useUi((s) => s.searchQuery);
  const setQuery = useUi((s) => s.setSearchQuery);
  return (
    <label className="m-search">
      <Search size={18} className="m-search__icon" />
      <input
        id="global-search"
        value={query}
        placeholder="Треки, исполнители, ссылки"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        enterKeyHint="search"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // «Найти» на клавиатуре прячет её, чтобы были видны результаты
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {query && (
        <button
          className="icon-btn icon-btn--sm"
          onClick={() => {
            setQuery('');
            document.getElementById('global-search')?.focus();
          }}
          aria-label="Очистить"
        >
          <X size={18} />
        </button>
      )}
    </label>
  );
}
