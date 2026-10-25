import { Heart, LoaderCircle, Pause, Play, SkipForward } from 'lucide-react';
import { Artwork } from '../components/Artwork';
import { usePlaybackTime } from '../hooks/usePlaybackTime';
import { haptic } from '../lib/android';
import { trackKey } from '../lib/types';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { useSwipe } from './useSwipe';

/** Мини-плеер над нижней панелью. Касание открывает «Сейчас играет», свайп листает треки. */
export function MiniPlayer() {
  const track = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);
  const duration = usePlayer((s) => s.duration);
  const nowPlaying = useUi((s) => s.nowPlaying);
  const liked = useLibrary((s) => (track ? !!s.likedKeys[trackKey(track)] : false));
  const time = usePlaybackTime(!!track && !nowPlaying, 4);
  const swipe = useSwipe(
    () => {
      haptic('tick');
      void usePlayer.getState().next();
    },
    () => {
      haptic('tick');
      void usePlayer.getState().prev();
    },
  );

  if (!track) return null;
  const progress = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;

  return (
    <div className={`m-mini ${isPlaying ? 'is-playing' : ''}`} role="region" aria-label="Плеер" {...swipe}>
      <button className="m-mini__open" onClick={() => useUi.getState().setNowPlaying(true)} aria-label="Открыть «Сейчас играет»">
        <Artwork key={trackKey(track)} src={track.artworkSmall ?? track.artwork} size={44} radius={10} />
        <span className="m-mini__meta">
          <span className="m-mini__title">{track.title}</span>
          <span className="m-mini__artist">{track.artist}</span>
        </span>
      </button>
      <button
        className={`icon-btn like ${liked ? 'is-liked' : ''}`}
        onClick={() => useLibrary.getState().toggleLike(track)}
        aria-label={liked ? 'Убрать из любимых' : 'В любимые'}
      >
        <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
      </button>
      <button
        className="icon-btn m-mini__play"
        onClick={() => usePlayer.getState().togglePlay()}
        aria-label={isPlaying ? 'Пауза' : 'Играть'}
      >
        {isLoading ? (
          <LoaderCircle size={22} className="spin" />
        ) : isPlaying ? (
          <Pause size={22} fill="currentColor" />
        ) : (
          <Play size={22} fill="currentColor" />
        )}
      </button>
      <button className="icon-btn" onClick={() => void usePlayer.getState().next()} aria-label="Следующий">
        <SkipForward size={22} fill="currentColor" />
      </button>
      <span className="m-mini__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
    </div>
  );
}
