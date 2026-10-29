// Renders one slide on a fixed 1280×720 canvas that is scaled to whatever box it is placed in.
import React, { memo, useLayoutEffect, useRef, useState } from 'react';
import { artSrc, CALLOUT_KINDS, themeVars } from '../../lib/deckThemes';
import { B, Chart, Columns, Flow, MindMap, Stats, Timeline, Tree } from './Visuals';

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/** A box that keeps the slide's 16:9 canvas sharp at any size. `contain` letterboxes inside a parent of fixed height (fullscreen). */
export function ScaledFrame({ children, contain = false, className = '', ...rest }) {
  const ref = useRef(null);
  const [box, setBox] = useState({ s: 0.3, x: 0, y: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    const fit = () => {
      const w = el.clientWidth; const h = el.clientHeight;
      const s = contain ? Math.min(w / SLIDE_W, h / SLIDE_H) : w / SLIDE_W;
      setBox({ s, x: (w - SLIDE_W * s) / 2, y: contain ? (h - SLIDE_H * s) / 2 : 0 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [contain]);
  return (
    <div ref={ref} className={`dk-frame ${contain ? 'contain' : ''} ${className}`} {...rest}>
      <div className="dk-canvas" style={{ transform: `translate(${box.x}px, ${box.y}px) scale(${box.s})` }}>{children}</div>
    </div>
  );
}

/** Text with the slide's key phrases picked out (first occurrence of each, case-insensitive). */
function Marked({ text, marks }) {
  if (!marks?.length) return text;
  const spans = [];
  marks.forEach((m) => {
    // whole words only: "design" is not picked out of "designers"
    const hit = new RegExp(`(?<![\\p{L}\\p{N}])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
    if (hit && !spans.some(([a, b]) => hit.index < b && hit.index + m.length > a)) spans.push([hit.index, hit.index + hit[0].length]);
  });
  if (!spans.length) return text;
  spans.sort((x, y) => x[0] - y[0]);
  const out = [];
  let at = 0;
  spans.forEach(([a, b], k) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={k} className="dk-mark">{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Margin notes: the notation / exclamation / tip / remember badges along the bottom of a slide. */
function Callouts({ items, shown, from }) {
  if (!items?.length) return null;
  return (
    <div className={`dk-callouts n${items.length}`}>
      {items.map((c, i) => {
        const k = CALLOUT_KINDS[c.kind] || CALLOUT_KINDS.note;
        return (
          <B key={i} i={from + i} shown={shown} className={`dk-callout k-${c.kind}`}>
            <span className="dk-callout-mark" aria-hidden="true">{k.mark}</span>
            <span><small>{k.label}</small>{c.text}</span>
          </B>
        );
      })}
    </div>
  );
}

const Art = ({ slide, theme, className = '', w = 960, h = 540 }) => (
  slide.image ? <img className={`dk-art ${className}`} src={artSrc(slide.image, theme, w, h)} alt="" draggable="false" loading="lazy" /> : null
);

const SlideView = memo(function SlideView({ slide, theme, step = Infinity, animate = true, highContrast = false, index, total, deckTitle = '' }) {
  const shown = (i) => step === Infinity || i < step;
  const d = slide.data || {};
  const L = slide.layout;
  const hero = L === 'title' || L === 'quote';
  const list = ['concept', 'bullets', 'agenda', 'summary'].includes(L);
  const hasKey = list && !!slide.main_point;
  const hasNotes = (list || L === 'example') && !!slide.callouts?.length;
  const tight = hasKey || hasNotes;
  const marks = slide.highlights;
  const label = `Slide ${index != null ? index + 1 : ''}${total ? ` of ${total}` : ''}: ${slide.title}`;

  return (
    <section className={`dk-slide dk-l-${L} ${tight ? 'tight' : ''} anim-${slide.anim} ${animate ? '' : 'still'} ${step === Infinity ? '' : 'stepped'} ${highContrast ? 'hc' : ''}`} style={themeVars(theme, highContrast)}
      role="group" aria-roledescription="slide" aria-label={label}>
      <div className="dk-bg" aria-hidden="true" />
      <p className="dk-sr">{slide.alt}</p>

      {hero && <Art slide={slide} theme={theme} className="full" w={1280} h={720} />}

      {L === 'title' && (
        <div className="dk-hero">
          <h1 className="dk-in" style={{ '--i': 0 }}>{slide.title}</h1>
          <i className="dk-rule dk-in" style={{ '--i': 1 }} />
          {slide.subtitle && <p className="dk-in" style={{ '--i': 2 }}>{slide.subtitle}</p>}
        </div>
      )}

      {L === 'quote' && (
        <div className="dk-hero dk-quote">
          <span className="dk-qmark dk-in" style={{ '--i': 0 }}>“</span>
          <blockquote className="dk-in" style={{ '--i': 1 }}>{d.text}</blockquote>
          {d.source && <cite className="dk-in" style={{ '--i': 2 }}>— {d.source}</cite>}
        </div>
      )}

      {!hero && <h2 className="dk-title dk-in" style={{ '--i': 0 }}>{slide.title}</h2>}

      {hasKey && (
        <p className="dk-keypoint dk-in" style={{ '--i': 1 }}><small>KEY POINT</small><Marked text={slide.main_point} marks={marks} /></p>
      )}

      {list && (
        <div className={`dk-body ${slide.image ? 'with-art' : ''} ${hasKey ? 'has-key' : ''} ${hasNotes ? 'has-notes' : ''}`}>
          {L === 'agenda'
            ? <ol className="dk-list num">{slide.bullets.map((b, i) => <B key={i} i={i} shown={shown} className="dk-li">{b}</B>)}</ol>
            : <ul className="dk-list">{slide.bullets.map((b, i) => <B key={i} i={i} shown={shown} className="dk-li"><Marked text={b} marks={marks} /></B>)}</ul>}
          {slide.image && <figure className="dk-art-card dk-in" style={{ '--i': 2 }}><Art slide={slide} theme={theme} w={720} h={720} /></figure>}
        </div>
      )}

      {L === 'example' && (
        <div className={`dk-body dk-example ${hasNotes ? 'has-notes' : ''}`}>
          {slide.image && <figure className="dk-art-card dk-in" style={{ '--i': 1 }}><Art slide={slide} theme={theme} w={960} h={540} /></figure>}
          <div className="dk-example-text">
            <span className="dk-chip dk-in" style={{ '--i': 2 }}>EXAMPLE</span>
            <p className="dk-in" style={{ '--i': 3 }}><Marked text={d.text || ''} marks={marks} /></p>
            {d.takeaway && <p className="dk-sowhat dk-in" style={{ '--i': 4 }}><small>SO WHAT</small>{d.takeaway}</p>}
          </div>
        </div>
      )}

      {(list || L === 'example') && <Callouts items={slide.callouts} shown={shown} from={list ? slide.bullets.length : 0} />}

      {L === 'chart' && (
        <div className="dk-body chart">
          <div className="dk-chart-box dk-in" style={{ '--i': 1 }}><Chart data={d} /></div>
          <aside className="dk-note dk-in" style={{ '--i': 3 }}><small>WHAT IT SHOWS</small><p>{d.caption || slide.title}</p>{d.unit && <em>Unit: {d.unit}</em>}</aside>
        </div>
      )}
      {L === 'process' && <div className="dk-body visual"><Flow data={d} shown={shown} /></div>}
      {L === 'hierarchy' && <div className="dk-body visual"><Tree data={d} shown={shown} /></div>}
      {L === 'mindmap' && <div className="dk-body visual"><MindMap data={d} title={slide.title} shown={shown} /></div>}
      {(L === 'types' || L === 'compare') && <div className="dk-body visual"><Columns data={d} shown={shown} versus={L === 'compare'} /></div>}
      {L === 'timeline' && <div className="dk-body visual"><Timeline data={d} shown={shown} /></div>}
      {L === 'stats' && <div className="dk-body visual"><Stats data={d} shown={shown} animate={animate} /></div>}

      {!hero && (
        <footer className="dk-foot" aria-hidden="true"><span>{deckTitle}</span>{index != null && <span>{index + 1} / {total}</span>}</footer>
      )}
    </section>
  );
});

export default SlideView;
