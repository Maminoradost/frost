/**
 * Долгое нажатие пальцем без React и DOM, чтобы проверять тестами. Таймеры подставляются
 * снаружи (`schedule`), в приложении это window.setTimeout.
 */

/** Сколько держать палец, мс: как долгое нажатие в Android. */
export const LONG_PRESS_MS = 450;
/** Палец сдвинулся дальше, значит это прокрутка, а не нажатие, px. */
export const MOVE_TOLERANCE = 10;
/** Сколько после срабатывания глушить клик и системное контекстное меню, мс. */
const AFTERMATH_MS = 700;

type Schedule = (fn: () => void, ms: number) => () => void;

export class LongPress {
  private cancelTimer: (() => void) | null = null;
  private start: { x: number; y: number } | null = null;
  private firedAt = -Infinity;

  constructor(
    private readonly onFire: (x: number, y: number) => void,
    private readonly schedule: Schedule,
    private readonly now: () => number = Date.now,
  ) {}

  /** Палец коснулся. Мышь сюда не передаётся: у неё правая кнопка. */
  down(x: number, y: number) {
    this.cancel();
    this.start = { x, y };
    this.cancelTimer = this.schedule(() => this.fire(x, y), LONG_PRESS_MS);
  }

  move(x: number, y: number) {
    if (!this.start) return;
    if (Math.hypot(x - this.start.x, y - this.start.y) > MOVE_TOLERANCE) this.cancel();
  }

  /** Палец поднят или жест перехвачен прокруткой. */
  cancel() {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.start = null;
  }

  /** Сработало ли только что: тогда клик после отпускания пальца не должен включать трек. */
  get justFired() {
    return this.now() - this.firedAt < AFTERMATH_MS;
  }

  /**
   * WebView на долгое нажатие сам присылает contextmenu, иногда раньше нашего таймера.
   * true: событие относится к жесту пальцем (меню уже открыто или откроется сейчас), его надо
   * погасить. false: это правая кнопка мыши.
   */
  contextMenu(x: number, y: number): boolean {
    if (this.justFired) return true;
    if (!this.start) return false;
    this.fire(x, y);
    return true;
  }

  private fire(x: number, y: number) {
    this.cancel();
    this.firedAt = this.now();
    this.onFire(x, y);
  }
}
