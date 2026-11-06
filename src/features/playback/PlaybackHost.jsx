// The single, app-wide player. It lives in the shell so playback survives navigation; the full UI is portalled into the
// Audio Studio's slot when that tab is open, and everywhere else a mini player (with Media Session controls) stays on screen.
import React, { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { queueActions, useQueue } from '../../lib/queue';
import { playlistActions } from '../../lib/playlists';
import Player from './Player';
import { getPlayerSlot, playbackActions, subscribeSlot, usePlayback } from './playbackStore';
import { startPlaybackSync } from './playbackSync';
import { NewPlaylistModal } from '../../components/audio/LibraryViews';

export default function PlaybackHost() {
  const pb = usePlayback();
  const { dataVersion, notify, authStatus } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const slot = useSyncExternalStore(subscribeSlot, getPlayerSlot);
  const books = useQuery(() => api.audio.list(), [dataVersion]);
  const list = books.data || [];
  const onAudio = location.pathname === '/audio';
  const tab = new URLSearchParams(location.search).get('tab') || 'player';
  const [newPl, setNewPl] = React.useState({ open: false, seed: null });
  const miniRef = React.useRef(null);
  // publish the mini player's height so every page can keep that much room free below its content
  useEffect(() => {
    const el = miniRef.current;
    const root = document.documentElement;
    if (!el) { root.style.removeProperty('--mini-h'); return undefined; }
    const publish = () => root.style.setProperty('--mini-h', el.childElementCount ? `${el.offsetHeight + 12}px` : '0px');
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--mini-h'); };
  });

  // On the Audio Studio with nothing chosen yet, show the first ready album (same as before the player went global).
  const fallback = onAudio ? list.find((b) => b.status === 'ready')?.id : null;
  const bookId = pb.bookId || fallback;
  const queueVersion = useQueue().queue.length; // re-check when something is added while that album is loaded
  // an album shown on the Audio Studio becomes "the current album", so its mini player follows you to other pages
  useEffect(() => { if (fallback && !pb.bookId) playbackActions.remember(fallback); }, [fallback, pb.bookId]);

  // Queue + playlists follow the account across devices.
  useEffect(() => (authStatus === 'authed' ? startPlaybackSync(api.playback) : undefined), [authStatus]);

  // The queue never holds the album that is loaded in the player (adding the only/current book would otherwise list it twice).
  useEffect(() => { if (bookId) queueActions.removeWhole(bookId); }, [bookId, pb.nonce, queueVersion]);

  // Housekeeping: drop deleted albums from the queue, playlists and the player.
  useEffect(() => {
    if (!books.data) return;
    const ids = new Set(books.data.map((b) => b.id));
    queueActions.prune(ids);
    playlistActions.prune(ids);
    if (pb.bookId && !ids.has(pb.bookId)) playbackActions.stop();
  }, [books.data]); // eslint-disable-line

  if (!bookId) {
    return <NewPlaylistModal open={newPl.open} seedBookId={newPl.seed} onClose={() => setNewPl({ open: false, seed: null })} onCreated={() => notify('Playlist created')} />;
  }
  const visible = onAudio && tab === 'player' && !!slot;
  return (
    <>
      <div className="global-mini" ref={miniRef}>
        <Player key={`${bookId}:${pb.nonce}`} bookId={bookId} slot={slot} visible={visible} autoplay={pb.autoplay} startChapter={pb.chapter} library={list}
          onNavigate={(id, o) => playbackActions.play(id, o)} onOpen={() => navigate('/audio?tab=player')}
          onNewPlaylist={(seed) => setNewPl({ open: true, seed })} onPlayingChange={playbackActions.setPlaying} />
      </div>
      <NewPlaylistModal open={newPl.open} seedBookId={newPl.seed} onClose={() => setNewPl({ open: false, seed: null })}
        onCreated={() => notify('Playlist created')} />
    </>
  );
}
