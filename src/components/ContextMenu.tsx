import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IS_ANDROID } from '../lib/platform';
import { useUi, type MenuItem } from '../store/ui';

/** Меню действий: всплывающее у курсора в Windows, выезжающее снизу на телефоне. */
export function ContextMenu() {
  return IS_ANDROID ? <SheetMenu /> : <PopupMenu />;
}

function MenuItems({ items, close }: { items: MenuItem[]; close: () => void }) {
  return (
    <>
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="menu__sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu__item ${item.danger ? 'is-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onClick?.();
            }}
          >
            <span className="menu__icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ),
      )}
    </>
  );
}

/** Нижний лист Material 3: затемнение, ручка, крупные пункты. Закрывается касанием мимо и кнопкой «Назад». */
function SheetMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  if (!menu) return null;
  return (
    <div className="sheet-scrim" onClick={close} onContextMenu={(e) => e.preventDefault()}>
      <div className="sheet menu" role="menu" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" aria-hidden />
        <MenuItems items={menu.items} close={close} />
      </div>
    </div>
  );
}

/** Собственное контекстное меню (стеклянная панель), не выходит за край окна. */
function PopupMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8));
    setPos({ x, y });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onScroll = () => close();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, close]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="menu glass"
      role="menu"
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItems items={menu.items} close={close} />
    </div>
  );
}
