import { describe, expect, test } from 'bun:test';
import { LONG_PRESS_MS, LongPress, MOVE_TOLERANCE } from '../src/lib/longPress';

/** Ручные часы и таймеры: жест проверяется без настоящего времени. */
function harness() {
  let now = 0;
  const timers: { at: number; fn: () => void; off: boolean }[] = [];
  const fired: [number, number][] = [];
  const lp = new LongPress(
    (x, y) => fired.push([x, y]),
    (fn, ms) => {
      const t = { at: now + ms, fn, off: false };
      timers.push(t);
      return () => {
        t.off = true;
      };
    },
    () => now,
  );
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers) if (!t.off && t.at <= now) {
      t.off = true;
      t.fn();
    }
  };
  return { lp, fired, advance };
}

describe('долгое нажатие', () => {
  test('палец держат дольше порога: срабатывает один раз в точке касания', () => {
    const { lp, fired, advance } = harness();
    lp.down(100, 200);
    advance(LONG_PRESS_MS - 1);
    expect(fired).toEqual([]);
    advance(1);
    expect(fired).toEqual([[100, 200]]);
    advance(2000);
    expect(fired.length).toBe(1);
  });

  test('короткое касание и прокрутка не срабатывают', () => {
    const { lp, fired, advance } = harness();
    lp.down(0, 0);
    advance(200);
    lp.cancel();
    advance(1000);
    lp.down(0, 0);
    lp.move(0, MOVE_TOLERANCE + 1);
    advance(1000);
    expect(fired).toEqual([]);
  });

  test('небольшое дрожание пальца не мешает', () => {
    const { lp, fired, advance } = harness();
    lp.down(50, 50);
    lp.move(53, 54);
    advance(LONG_PRESS_MS);
    expect(fired.length).toBe(1);
  });

  test('contextmenu от WebView раньше таймера: одно срабатывание, событие гасится', () => {
    const { lp, fired, advance } = harness();
    lp.down(10, 10);
    advance(400);
    expect(lp.contextMenu(10, 10)).toBe(true);
    advance(500);
    expect(fired.length).toBe(1);
    // contextmenu после нашего срабатывания тоже гасится
    expect(lp.contextMenu(10, 10)).toBe(true);
    expect(fired.length).toBe(1);
  });

  test('клик сразу после срабатывания глушится, позже снова работает', () => {
    const { lp, advance } = harness();
    lp.down(0, 0);
    advance(LONG_PRESS_MS);
    expect(lp.justFired).toBe(true);
    advance(1000);
    expect(lp.justFired).toBe(false);
  });

  test('правая кнопка мыши (без касания) не перехватывается', () => {
    const { lp, fired } = harness();
    expect(lp.contextMenu(5, 5)).toBe(false);
    expect(fired).toEqual([]);
  });
});
