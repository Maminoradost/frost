import { IS_ANDROID } from './platform';

/**
 * Понятные причины ошибок воспроизведения.
 *
 * Ядро, RustyPipe и элемент <audio> присылают технический текст: «YouTube Music: content
 * unavailable (AgeRestricted)…», «Доступ запрещён… (HTTP 403)», «сетевая ошибка». Здесь он
 * превращается в короткое объяснение для человека и решение, стоит ли пробовать тот же
 * трек ещё раз (сбой сети, устаревшая ссылка) или сразу переходить к следующему
 * (трек удалён, возрастное ограничение, недоступен в стране).
 */
export type PlayErrorKind = 'age' | 'region' | 'unavailable' | 'blocked' | 'expired' | 'network' | 'unknown';

export interface PlayError {
  kind: PlayErrorKind;
  /** Причина для пользователя, со строчной буквы: вставляется после «Не удалось воспроизвести: ». */
  text: string;
  /** Есть смысл ещё раз попробовать тот же трек, а не сразу листать дальше. */
  retry: boolean;
}

interface Rule {
  kind: PlayErrorKind;
  test: RegExp;
  text: string;
  retry: boolean;
}

/** Порядок важен: первое совпадение побеждает (причины трека раньше сетевых). */
const RULES: Rule[] = [
  {
    kind: 'age',
    test: /age.?restrict|возрастн/i,
    text: 'у трека возрастное ограничение, YouTube не отдаёт его без входа в аккаунт',
    retry: false,
  },
  {
    kind: 'region',
    test: /geo.?block|not available in your country|в вашей стране|в вашем регионе/i,
    text: 'трек недоступен в вашей стране',
    retry: false,
  },
  {
    kind: 'unavailable',
    test: /\(deleted\)|\(private\)|members.?only|\(premium\)|unplayable|video unavailable|has been removed|не найдено|HTTP 404/i,
    text: 'трек удалён, скрыт или доступен только по подписке',
    retry: false,
  },
  {
    kind: 'blocked',
    test: /not a bot|bot.?detect|sign in to confirm|ip.?ban|captcha|po.?token|HTTP 429|слишком много запросов|HTTP 403|доступ запрещён/i,
    text: 'YouTube временно ограничил доступ. Подождите минуту или смените сеть (VPN)',
    retry: true,
  },
  {
    kind: 'expired',
    test: /устарел|HTTP 410|expired/i,
    text: 'ссылка на поток устарела',
    retry: true,
  },
  {
    kind: 'network',
    test: /не отвечает|не ответил|не удалось подключиться|оборвал|сетев|прервана|сейчас недоступен|временно недоступен|нет данных|HTTP 5\d\d|timed? ?out|connection|network|dns|failed to fetch|load failed/i,
    text: 'нет связи с сервером. Проверьте интернет или VPN',
    retry: true,
  },
];

/** Убирает советы про yt-dlp: на Android его нет, YouTube там работает только через RustyPipe. */
function withoutYtdlpAdvice(text: string): string {
  const kept = text
    .split(/(?<=\.)\s+/)
    .filter((part) => !/yt-dlp/i.test(part))
    .join(' ')
    .trim();
  return kept || text;
}

/** Технический текст ошибки → причина для человека и нужна ли повторная попытка. */
export function describePlayError(raw: string, android = IS_ANDROID): PlayError {
  const text = raw.trim();
  for (const rule of RULES) {
    if (rule.test.test(text)) return { kind: rule.kind, text: rule.text, retry: rule.retry };
  }
  let shown = android ? withoutYtdlpAdvice(text) : text;
  shown = shown.replace(/[.\s]+$/, '');
  if (!shown) shown = 'неизвестная ошибка';
  return { kind: 'unknown', text: shown.charAt(0).toLowerCase() + shown.slice(1), retry: true };
}

/** Через сколько повторить тот же трек после сбоя сети, мс. */
export const RETRY_DELAY = 1500;
/** Пауза перед переходом к следующему треку после ошибки, мс: успеть прочитать причину. */
export const SKIP_DELAY = 1200;
/** Сколько треков подряд может не сыграть, прежде чем плеер остановится. */
export const MAX_FAILED_IN_ROW = 3;
/** Трек, который играл дольше этого, после нового обрыва снова получает повторную попытку, мс. */
const FRESH_AFTER = 30_000;

export type FailureDecision =
  /** Тот же трек ещё раз (с той же секунды) через `delay` мс, без сообщения. */
  | { action: 'retry'; delay: number; error: PlayError }
  /** Сообщить причину и через `delay` мс перейти к следующему треку. */
  | { action: 'skip'; delay: number; error: PlayError; message: string }
  /** Слишком много ошибок подряд: остановиться и предложить «Повторить». */
  | { action: 'stop'; error: PlayError; message: string };

/**
 * Решает, что делать после ошибки воспроизведения: повторить трек, перейти к следующему или
 * остановиться. Без таймеров и стора, чтобы логику можно было проверить тестами.
 *
 * - сбой сети или устаревшая ссылка: один повтор того же трека;
 * - трек удалён, недоступен в стране, возрастное ограничение: сразу следующий;
 * - после `MAX_FAILED_IN_ROW` неудачных треков подряд воспроизведение останавливается.
 */
export class PlayFailures {
  private key = '';
  private retries = 0;
  private playingSince = 0;
  /** Сколько треков подряд не сыграло. */
  streak = 0;

  /** Трек заиграл. */
  playing(now = Date.now()) {
    this.streak = 0;
    this.playingSince = now;
  }

  /** Пользователь сам запустил воспроизведение: всё с чистого листа. */
  reset() {
    this.key = '';
    this.retries = 0;
    this.playingSince = 0;
    this.streak = 0;
  }

  decide(key: string, title: string, raw: string, android = IS_ANDROID, now = Date.now()): FailureDecision {
    const error = describePlayError(raw, android);
    if (this.key !== key) {
      this.key = key;
      this.retries = 0;
    } else if (this.playingSince && now - this.playingSince > FRESH_AFTER) {
      // Трек долго играл и оборвался снова: это новый сбой, а не тот же
      this.retries = 0;
    }
    this.playingSince = 0;
    if (error.retry && this.retries < 1) {
      this.retries += 1;
      return { action: 'retry', delay: RETRY_DELAY, error };
    }
    this.streak += 1;
    const name = title.trim() ? `«${title.trim()}»` : 'трек';
    const reason = `Не удалось воспроизвести ${name}: ${error.text}`;
    if (this.streak >= MAX_FAILED_IN_ROW) {
      this.streak = 0;
      return { action: 'stop', error, message: `${reason}. ${MAX_FAILED_IN_ROW} трека подряд не сыграли, воспроизведение остановлено` };
    }
    return { action: 'skip', delay: SKIP_DELAY, error, message: `${reason}. Включаем следующий` };
  }
}
