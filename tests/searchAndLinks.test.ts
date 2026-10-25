import { describe, expect, test } from 'bun:test';
import { cleanLink, extractLink, isLink, isSupportedLink } from '../src/lib/shareLinks';
import { HISTORY_LIMIT, forget, remember, suggestFor, worthRemembering } from '../src/lib/searchHistory';

describe('история поиска', () => {
  test('новый запрос в начало, повтор поднимается наверх без дубля', () => {
    let h = remember([], 'кино');
    h = remember(h, 'Земфира');
    h = remember(h, '  КИНО ');
    expect(h).toEqual(['КИНО', 'Земфира']);
  });

  test('пустое, одна буква и ссылки не запоминаются', () => {
    expect(worthRemembering(' ')).toBe(false);
    expect(worthRemembering('я')).toBe(false);
    expect(worthRemembering('https://soundcloud.com/x')).toBe(false);
    expect(remember(['a b'], 'https://youtu.be/x')).toEqual(['a b']);
  });

  test('не больше лимита и удаление без учёта регистра', () => {
    let h: string[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = remember(h, `запрос ${i}`);
    expect(h.length).toBe(HISTORY_LIMIT);
    expect(h[0]).toBe(`запрос ${HISTORY_LIMIT + 4}`);
    expect(forget(['Кино', 'ДДТ'], 'кино')).toEqual(['ДДТ']);
  });

  test('подсказки: свои с начала, свои с середины, потом источник, без повторов и самого запроса', () => {
    const history = ['Кино группа крови', 'Сплин', 'лучшее кино 80-х'];
    const remote = ['кино', 'кино звезда по имени солнце', 'Кино группа крови'];
    expect(suggestFor('кино', history, remote)).toEqual(['Кино группа крови', 'лучшее кино 80-х', 'кино звезда по имени солнце']);
    expect(suggestFor('', history, remote)).toEqual([]);
    expect(suggestFor('https://youtu.be/x', history, remote)).toEqual([]);
    expect(suggestFor('к', history, remote, 2).length).toBe(2);
  });
});

describe('ссылки из «Поделиться»', () => {
  test('голая ссылка YouTube Music', () => {
    expect(extractLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc')).toBe('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc');
  });

  test('ссылка внутри текста SoundCloud и пунктуация на конце', () => {
    expect(extractLink('Послушайте Song от Artist на #SoundCloud\nhttps://on.soundcloud.com/AbCd123.')).toBe('https://on.soundcloud.com/AbCd123');
    expect(extractLink('(см. https://youtu.be/abc)')).toBe('https://youtu.be/abc');
  });

  test('из нескольких ссылок берётся поддерживаемая', () => {
    expect(extractLink('https://example.com/a и https://soundcloud.com/artist/track')).toBe('https://soundcloud.com/artist/track');
    expect(extractLink('https://example.com/a')).toBe('https://example.com/a');
    expect(extractLink('просто текст')).toBeNull();
    expect(extractLink(null)).toBeNull();
  });

  test('какие ссылки Frost открывает сам', () => {
    for (const ok of ['https://music.youtube.com/playlist?list=PL1', 'https://www.youtube.com/watch?v=x', 'https://m.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://soundcloud.com/a/b', 'https://m.soundcloud.com/a', 'https://on.soundcloud.com/x']) {
      expect(isSupportedLink(ok)).toBe(true);
    }
    for (const bad of ['https://example.com', 'https://notyoutube.com/watch', 'https://soundcloud.com.evil.io/x', 'ftp://youtu.be/x']) {
      expect(isSupportedLink(bad)).toBe(false);
    }
    expect(isLink(' https://x.y ')).toBe(true);
  });

  test('метки отслеживания убираются, остальное остаётся', () => {
    expect(cleanLink('https://music.youtube.com/watch?v=abc&si=XYZ&utm_source=tg&list=RD1')).toBe('https://music.youtube.com/watch?v=abc&list=RD1');
    expect(cleanLink('не ссылка')).toBe('не ссылка');
  });
});
