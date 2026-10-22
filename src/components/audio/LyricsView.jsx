// Synced transcript ("lyrics") for read-aloud: the sentence being spoken fills in word by word, its neighbours
// fade and blur away, and any word you tap becomes the new starting point.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

const WORD = /\S+\s*/g;

/** [{text, start}] — each word with trailing space, and its offset inside the sentence. */
const wordsOf = (text) => [...text.matchAll(WORD)].map((m) => ({ text: m[0], start: m.index }));

const Line = memo(function Line({ text, index, distance, char, onSeek }) {
  const current = distance === 0;
  const words = useMemo(() => (current ? wordsOf(text) : null), [current, text]);
  const opacity = current ? 1 : Math.max(0.16, 0.62 - (distance - 1) * 0.14);
  const blur = current || distance < 3 ? 0 : Math.min(3.5, (distance - 2) * 0.9);
  return (
    <div className={`lyric-line ${current ? 'current' : ''}`} style={{ opacity, filter: blur ? `blur(${blur}px)` : undefined }}
      aria-current={current ? 'true' : undefined}>
      {current ? words.map((w, i) => {
        const next = words[i + 1]?.start ?? Infinity;
        const state = char >= next ? 'sung' : char >= w.start ? 'now' : 'next';
        return <button key={w.start} type="button" className={`lyric-word ${state}`} onClick={() => onSeek(index, w.start)}>{w.text}</button>;
      }) : (
        <button type="button" className="lyric-whole" onClick={() => onSeek(index, 0)}>{text}</button>
      )}
    </div>
  );
});

export default function LyricsView({ narrator, reducedMotion = false, className = '' }) {
  const [pos, setPos] = useState(() => ({ chapter: narrator.chapter, segment: narrator.segment, playing: narrator.playing, char: narrator.charIndex || 0 }));
  const boxRef = useRef(null);
  const currentRef = useRef(null);

  // Narrator emits on every word; re-render only when the sentence, play state or spoken word changes.
  useEffect(() => narrator.on((s) => setPos((p) => {
    const char = s.charIndex || 0;
    return p.chapter === s.chapter && p.segment === s.segment && p.playing === s.playing && p.char === char
      ? p : { chapter: s.chapter, segment: s.segment, playing: s.playing, char };
  })), [narrator]);

  useEffect(() => {
    const box = boxRef.current;
    const el = currentRef.current;
    if (!box || !el) return;
    box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.32), behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [pos.chapter, pos.segment, reducedMotion]);

  const segments = narrator.script[pos.chapter]?.segments || [];
  const seek = (i, offset) => {
    narrator.seek(pos.chapter, i, offset);
    if (!narrator.playing) narrator.play();
  };

  if (!segments.length) return <div className={`lyrics ${className}`}><p className="lyrics-empty">Nothing to show yet.</p></div>;

  return (
    <div className={`lyrics ${className}`} ref={boxRef} aria-label="Synced text">
      {!pos.playing && pos.segment === 0 && !pos.char && <div className="lyrics-dots" aria-hidden="true"><i /><i /><i /></div>}
      {segments.map((seg, i) => {
        const distance = Math.abs(i - pos.segment);
        return (
          <div key={i} ref={distance === 0 ? currentRef : undefined} className="lyric-wrap">
            <Line text={seg.text} index={i} distance={Math.min(distance, 8)} char={distance === 0 ? pos.char : 0} onSeek={seek} />
          </div>
        );
      })}
    </div>
  );
}
