import { describe, expect, test } from 'bun:test';
import { MAX_FAILED_IN_ROW, PlayFailures, RETRY_DELAY, describePlayError } from '../src/lib/playError';

describe('понятные причины ошибок воспроизведения', () => {
  test('возрастное ограничение и регион: без повтора', () => {
    const age = describePlayError('YouTube Music: content unavailable (AgeRestricted)', false);
    expect(age.kind).toBe('age');
    expect(age.retry).toBe(false);
    const region = describePlayError('Video is not available in your country (GeoBlocked)', false);
    expect(region.kind).toBe('region');
    expect(region.retry).toBe(false);
  });

  test('удалённый или платный трек: сразу следующий', () => {
    for (const raw of ['content unavailable (Deleted)', 'Video unavailable', 'members-only content', 'HTTP 404']) {
      const e = describePlayError(raw, false);
      expect(e.kind).toBe('unavailable');
      expect(e.retry).toBe(false);
    }
  });

  test('блокировка YouTube, устаревшая ссылка и сеть: стоит повторить', () => {
    expect(describePlayError("Sign in to confirm you're not a bot", false)).toMatchObject({ kind: 'blocked', retry: true });
    expect(describePlayError('Доступ запрещён (HTTP 403)', false)).toMatchObject({ kind: 'blocked', retry: true });
    expect(describePlayError('ссылка устарела (HTTP 410)', false)).toMatchObject({ kind: 'expired', retry: true });
    expect(describePlayError('сетевая ошибка', false)).toMatchObject({ kind: 'network', retry: true });
    expect(describePlayError('error sending request: connection timed out', false)).toMatchObject({ kind: 'network', retry: true });
  });

  test('причины трека важнее сетевых слов в том же тексте', () => {
    expect(describePlayError('network: content unavailable (AgeRestricted)', false).kind).toBe('age');
  });

  test('неизвестная ошибка: текст как есть, со строчной буквы, на Android без советов про yt-dlp', () => {
    const desktop = describePlayError('Странный сбой. Обновите yt-dlp в настройках.', false);
    expect(desktop.kind).toBe('unknown');
    expect(desktop.text).toBe('странный сбой. Обновите yt-dlp в настройках');
    const android = describePlayError('Странный сбой. Обновите yt-dlp в настройках.', true);
    expect(android.text).toBe('странный сбой');
    expect(describePlayError('   ', true).text).toBe('неизвестная ошибка');
  });
});

describe('что делать после ошибки', () => {
  test('сбой сети: один повтор того же трека, потом следующий', () => {
    const f = new PlayFailures();
    const first = f.decide('youtube:a', 'Группа крови', 'сетевая ошибка', true, 1000);
    expect(first).toMatchObject({ action: 'retry', delay: RETRY_DELAY });
    const second = f.decide('youtube:a', 'Группа крови', 'сетевая ошибка', true, 3000);
    expect(second.action).toBe('skip');
    if (second.action === 'skip') expect(second.message).toBe('Не удалось воспроизвести «Группа крови»: нет связи с сервером. Проверьте интернет или VPN. Включаем следующий');
  });

  test('трек недоступен: без повтора, сразу следующий', () => {
    const f = new PlayFailures();
    const d = f.decide('youtube:b', 'Кукушка', 'content unavailable (AgeRestricted)', true, 0);
    expect(d.action).toBe('skip');
    expect(f.streak).toBe(1);
  });

  test('три трека подряд: остановка с кнопкой «Повторить», затем счёт с нуля', () => {
    const f = new PlayFailures();
    const raw = 'video unavailable';
    expect(f.decide('sc:1', 'Один', raw, false, 0).action).toBe('skip');
    expect(f.decide('sc:2', 'Два', raw, false, 0).action).toBe('skip');
    const stop = f.decide('sc:3', 'Три', raw, false, 0);
    expect(stop.action).toBe('stop');
    if (stop.action === 'stop') expect(stop.message).toContain(`${MAX_FAILED_IN_ROW} трека подряд`);
    expect(f.streak).toBe(0);
  });

  test('трек заиграл: счётчик ошибок подряд сбрасывается', () => {
    const f = new PlayFailures();
    f.decide('sc:1', 'Один', 'video unavailable', false, 0);
    f.decide('sc:2', 'Два', 'video unavailable', false, 0);
    f.playing(10);
    expect(f.streak).toBe(0);
    expect(f.decide('sc:3', 'Три', 'video unavailable', false, 20).action).toBe('skip');
  });

  test('долго игравший трек после нового обрыва снова получает повтор', () => {
    const f = new PlayFailures();
    expect(f.decide('yt:long', 'Микс', 'сетевая ошибка', true, 0).action).toBe('retry');
    f.playing(2_000);
    // Через 5 минут снова оборвалось: это новый сбой
    expect(f.decide('yt:long', 'Микс', 'сетевая ошибка', true, 302_000).action).toBe('retry');
    // А если оборвалось сразу после повтора, повторять бессмысленно
    f.playing(303_000);
    expect(f.decide('yt:long', 'Микс', 'сетевая ошибка', true, 305_000).action).toBe('skip');
  });

  test('после reset всё с чистого листа', () => {
    const f = new PlayFailures();
    f.decide('yt:x', 'X', 'сетевая ошибка', true, 0);
    f.decide('yt:x', 'X', 'сетевая ошибка', true, 0);
    f.reset();
    expect(f.streak).toBe(0);
    expect(f.decide('yt:x', 'X', 'сетевая ошибка', true, 0).action).toBe('retry');
  });

  test('без названия: «трек»', () => {
    const f = new PlayFailures();
    const d = f.decide('yt:y', '  ', 'HTTP 404', true, 0);
    expect(d.action === 'skip' && d.message.startsWith('Не удалось воспроизвести трек: ')).toBe(true);
  });
});
