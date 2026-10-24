import { ChevronDown, EllipsisVertical, Heart, ListMusic, MicVocal, Share2 } from 'lucide-react';
import { useEffect, useRef, type PointerEvent } from 'react';
import { Artwork } from '../components/Artwork';
import { LyricsView } from '../components/Lyrics';
import { trackMenuItems } from '../components/menus';
import { Controls, SeekBar } from '../components/PlayerBar';
import { QueueList } from '../components/SidePanel';
import { SleepTimer } from '../components/SleepTimer';
import { shareText } from '../lib/android';
import { trackKey } from '../lib/types';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { useMobile, type NpView } from './store';
import { useSwipe } from './useSwipe';

/** Расстояние в пикселях, после которого жест вниз закрывает экран. */
const CLOSE_DISTANCE = 120;

/**
 * Полноэкранный «Сейчас играет»: обложка (свайп листает треки), текст и очередь вместо обложки,
 * перемотка и управление внизу. Закрывается стрелкой, жестом вниз и кнопкой «Назад».
 */
export function MobileNowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const setOpen = useUi((s) => s.setNowPlaying);
  const track = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const source = usePlayer((s) => s.source);
  const view = useMobile((s) => s.npView);
  const setView = useMobile((s) => s.setNpView);
  const liked = useLibrary((s) => (track ? !!s.likedKeys[trackKey(track)] : false));
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; id: number; dy: number } | null>(null);
  const swipe = useSwipe(
    () => void usePlayer.getState().next(),
    () => void usePlayer.getState().prev(),
  );

  // Каждый раз открывается на обложке
  useEffect(() => {
    if (open) setView('art');
  }, [open, setView]);

  // Трек закончился и очередь пуста: закрывать нечего
  useEffect(() => {
    if (open && !track) setOpen(false);
  }, [open, setOpen, track]);

  if (!open || !track) return null;
  const artistId = track.artistId;

  const toggle = (next: NpView) => setView(view === next ? 'art' : next);

  // Жест вниз за верхнюю панель или обложку
  const onDragStart = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { y: e.clientY, id: e.pointerId, dy: 0 };
  };
  const onDragMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !sheet.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    sheet.current.style.transition = 'none';
    sheet.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onDragEnd = () => {
    const d = drag.current;
    drag.current = null;
    const el = sheet.current;
    if (!d || !el) return;
    el.style.transition = '';
    el.style.transform = '';
    if (d.dy > CLOSE_DISTANCE) setOpen(false);
  };
  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd,
  };

  const link = track.permalink;

  return (
    <div ref={sheet} className={`m-np ${isPlaying ? 'is-playing' : ''}`} role="dialog" aria-modal="true" aria-label="Сейчас играет">
      <div className="m-np__bg" aria-hidden>
        {(track.artwork ?? track.artworkSmall) && <img key={track.artwork ?? track.artworkSmall} src={track.artwork ?? track.artworkSmall} alt="" />}
      </div>

      <header className="m-np__top" {...dragHandlers}>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Свернуть">
          <ChevronDown size={26} />
        </button>
        <div className="m-np__source">
          <span className="eyebrow">Сейчас играет</span>
          <span className="m-np__source-name">{source ?? 'Frost'}</span>
        </div>
        <button
          className="icon-btn"
          onClick={(e) => useUi.getState().openMenu(e.clientX, e.clientY, trackMenuItems(track))}
          aria-label="Действия с треком"
        >
          <EllipsisVertical size={22} />
        </button>
      </header>

      <div className="m-np__body">
        {view === 'art' ? (
          <div
            className="m-np__art-wrap"
            onPointerDown={(e) => {
              onDragStart(e);
              swipe.onPointerDown(e);
            }}
            onPointerMove={onDragMove}
            onPointerUp={(e) => {
              onDragEnd();
              swipe.onPointerUp(e);
            }}
            onPointerCancel={() => {
              onDragEnd();
              swipe.onPointerCancel();
            }}
          >
            <Artwork key={trackKey(track)} src={track.artwork ?? track.artworkSmall} radius={28} className="m-np__art" />
          </div>
        ) : (
          <div className="m-np__panel">
            {view === 'lyrics' ? <LyricsView key={trackKey(track)} track={track} large /> : <QueueList />}
          </div>
        )}
      </div>

      <div className="m-np__meta">
        <div className="m-np__titles">
          <h1 className="m-np__title">{track.title}</h1>
          {artistId ? (
            <button
              className="link m-np__artist"
              onClick={() => useUi.getState().navigate({ name: 'artist', provider: track.provider, id: artistId })}
            >
              {track.artist}
            </button>
          ) : (
            <span className="m-np__artist">{track.artist}</span>
          )}
        </div>
        <button
          className={`icon-btn like ${liked ? 'is-liked' : ''}`}
          onClick={() => useLibrary.getState().toggleLike(track)}
          aria-label={liked ? 'Убрать из любимых' : 'В любимые'}
        >
          <Heart size={24} fill={liked ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="m-np__seek">
        <SeekBar large />
      </div>
      <div className="m-np__controls">
        <Controls large />
      </div>

      <nav className="m-np__tabs" aria-label="Дополнительно">
        <button className={`m-np__tab ${view === 'lyrics' ? 'is-on' : ''}`} onClick={() => toggle('lyrics')} aria-pressed={view === 'lyrics'}>
          <MicVocal size={20} />
          <span>Текст</span>
        </button>
        <SleepTimer />
        {link && (
          <button className="m-np__tab" onClick={() => void shareText(`${track.title} · ${track.artist}\n${link}`)} aria-label="Поделиться">
            <Share2 size={20} />
          </button>
        )}
        <button className={`m-np__tab ${view === 'queue' ? 'is-on' : ''}`} onClick={() => toggle('queue')} aria-pressed={view === 'queue'}>
          <ListMusic size={20} />
          <span>Очередь</span>
        </button>
      </nav>
    </div>
  );
}
