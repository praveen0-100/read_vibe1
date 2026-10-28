// Reading view for audiobooks and podcasts: the current chapter as flowing text, the sentence being spoken
// highlighted, any sentence tappable to continue from there, with chapter stepping and text size.
import React, { memo, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';

const SIZES = [14, 16, 18, 20, 23, 27];
const PARAGRAPH = 5; // sentences per paragraph when the script has no turn boundaries

const Sentence = memo(function Sentence({ text, index, current, silent, onSeek }) {
  return (
    <>
      <span role="button" tabIndex={0} className={`rv-s ${current ? 'now' : ''} ${silent ? 'dim' : ''}`}
        onClick={() => onSeek(index)} onKeyDown={(e) => e.key === 'Enter' && onSeek(index)}>{text}</span>{' '}
    </>
  );
});

/** Groups sentences into paragraphs: a new speaker turn starts one, otherwise every few sentences. */
function paragraphsOf(segments) {
  const out = [];
  let cur = null;
  segments.forEach((seg, i) => {
    if (!cur || (seg.first && cur.items.length) || cur.items.length >= PARAGRAPH) { cur = { who: seg.first ? seg.speaker : null, items: [] }; out.push(cur); }
    cur.items.push({ seg, i });
  });
  return out;
}

export default function ReaderView({ narrator, lang, speakers, reducedMotion = false, className = '' }) {
  const [pos, setPos] = useState(() => ({ chapter: narrator.chapter, segment: narrator.segment }));
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem('readvibe.audioreader.size')) || 18; } catch { return 18; } });
  const boxRef = useRef(null);
  const nowRef = useRef(null);

  // The narrator emits on every word; only a new sentence or chapter needs a re-render.
  useEffect(() => narrator.on((s) => setPos((p) => (p.chapter === s.chapter && p.segment === s.segment ? p : { chapter: s.chapter, segment: s.segment }))), [narrator]);

  useEffect(() => {
    const box = boxRef.current;
    const el = nowRef.current;
    if (!box || !el) return;
    box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.3), behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [pos.chapter, pos.segment, reducedMotion]);

  const chapters = narrator.script;
  const chapter = chapters[pos.chapter];
  const resize = (d) => {
    const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(size) + d))] ?? 18;
    setSize(next);
    try { localStorage.setItem('readvibe.audioreader.size', String(next)); } catch { /* private mode */ }
  };
  const seek = (i) => { narrator.seek(pos.chapter, i); if (!narrator.playing) narrator.play(); };
  const go = (c) => { narrator.seek(c, 0); if (!narrator.playing) narrator.play(); };

  if (!chapter?.segments?.length) return <div className={`reader-view ${className}`}><p className="lyrics-empty">Nothing to read yet.</p></div>;

  return (
    <div className={`reader-view ${className}`}>
      <div className="rv-bar">
        <button onClick={() => go(pos.chapter - 1)} disabled={pos.chapter <= 0} aria-label="Previous chapter"><ChevronLeft size={18} /></button>
        <span className="rv-count">{chapters.length > 1 ? `${pos.chapter + 1} / ${chapters.length}` : ''}</span>
        <button onClick={() => go(pos.chapter + 1)} disabled={pos.chapter >= chapters.length - 1} aria-label="Next chapter"><ChevronRight size={18} /></button>
        <span className="rv-spacer" />
        <button onClick={() => resize(-1)} disabled={size <= SIZES[0]} aria-label="Smaller text"><Minus size={15} /></button>
        <span className="rv-aa" aria-hidden="true">Aa</span>
        <button onClick={() => resize(1)} disabled={size >= SIZES[SIZES.length - 1]} aria-label="Larger text"><Plus size={15} /></button>
      </div>
      <article className="rv-page" ref={boxRef} lang={lang} style={{ fontSize: size }}>
        <h3>{chapter.title}</h3>
        {paragraphsOf(chapter.segments).map((p, k) => (
          <p key={k}>
            {p.who && speakers?.[p.who]?.name && <b className={`rv-who ${p.who}`}>{speakers[p.who].name}</b>}
            {p.items.map(({ seg, i }) => (
              <span key={i} ref={i === pos.segment ? nowRef : undefined} className="rv-wrap">
                <Sentence text={seg.text} index={i} current={i === pos.segment} silent={seg.silent} onSeek={seek} />
              </span>
            ))}
          </p>
        ))}
      </article>
    </div>
  );
}
