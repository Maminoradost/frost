import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { haptic } from '../lib/android';
import { LongPress } from '../lib/longPress';

/**
 * Долгое нажатие пальцем: виброотклик и `onLongPress(x, y)`. Правая кнопка мыши уходит в
 * `onMouseMenu`, как раньше. После срабатывания глушится клик (иначе трек ещё и включится) и
 * системное меню WebView.
 */
export function useLongPress(onLongPress: (x: number, y: number) => void, onMouseMenu?: (e: MouseEvent) => void) {
  const callback = useRef(onLongPress);
  callback.current = onLongPress;
  const press = useRef<LongPress | null>(null);
  if (!press.current) {
    press.current = new LongPress(
      (x, y) => {
        haptic('long');
        callback.current(x, y);
      },
      (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    );
  }
  const p = press.current;

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      p.down(e.clientX, e.clientY);
    },
    onPointerMove: (e: PointerEvent) => p.move(e.clientX, e.clientY),
    onPointerUp: () => p.cancel(),
    onPointerCancel: () => p.cancel(),
    onPointerLeave: () => p.cancel(),
    onClickCapture: (e: MouseEvent) => {
      if (!p.justFired) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: MouseEvent) => {
      if (p.contextMenu(e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onMouseMenu?.(e);
    },
  };
}
