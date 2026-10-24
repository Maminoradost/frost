import { lazy } from 'react';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { LikedPage } from './pages/LikedPage';
import { LocalPlaylistPage, RemotePlaylistPage } from './pages/PlaylistPage';
import { SearchPage } from './pages/SearchPage';
import type { Route } from './store/ui';

// Редкие страницы грузятся по требованию: быстрее первый запуск
const ArtistPage = lazy(() => import('./pages/ArtistPage').then((m) => ({ default: m.ArtistPage })));
const GenrePage = lazy(() => import('./pages/GenrePage').then((m) => ({ default: m.GenrePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LocalPage = lazy(() => import('./pages/LocalPage').then((m) => ({ default: m.LocalPage })));
const WrappedPage = lazy(() => import('./pages/WrappedPage').then((m) => ({ default: m.WrappedPage })));

/** Страница по маршруту. Общая для окна Windows и мобильной оболочки. */
export function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'search':
      return <SearchPage />;
    case 'library':
      return <LibraryPage tab={route.tab ?? 'playlists'} />;
    case 'liked':
      return <LikedPage />;
    case 'local-playlist':
      return <LocalPlaylistPage id={route.id} />;
    case 'playlist':
      return <RemotePlaylistPage provider={route.provider} id={route.id} />;
    case 'artist':
      return <ArtistPage provider={route.provider} id={route.id} />;
    case 'genre':
      return <GenrePage key={`${route.provider}:${route.id}`} provider={route.provider} id={route.id} title={route.title} />;
    case 'local':
      return <LocalPage tab={route.tab ?? 'tracks'} />;
    case 'wrapped':
      return <WrappedPage />;
    case 'settings':
      return <SettingsPage />;
  }
}
