import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { forget, remember } from '../lib/searchHistory';

/** Последние поисковые запросы (на этом устройстве). */
interface SearchHistoryState {
  queries: string[];
  add: (q: string) => void;
  remove: (q: string) => void;
  clear: () => void;
}

export const useSearchHistory = create<SearchHistoryState>()(
  persist(
    (set) => ({
      queries: [],
      add: (q) => set((s) => ({ queries: remember(s.queries, q) })),
      remove: (q) => set((s) => ({ queries: forget(s.queries, q) })),
      clear: () => set({ queries: [] }),
    }),
    { name: 'frost.searchHistory', version: 1 },
  ),
);

/** Запомнить запрос: Enter, уход из поля, выбор подсказки, голосовой поиск. */
export const rememberSearch = (q: string) => useSearchHistory.getState().add(q);
