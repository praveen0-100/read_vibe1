// ─── Paged mobile reader ─────────────────────────────────────────────────────
// Book-style reading for phones: the chapter is laid out in CSS columns and turned page by page
// (tap the edges, swipe, or use the arrow keys). Chrome (top/bottom bars) appears on a centre tap.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, AudioLines, BookOpen, Bookmark, BookmarkCheck, CloudDownload, Download, Headphones, List, MoreHorizontal, Moon, Search,
  Sparkles, StickyNote, Trash2, Type, WifiOff, X, ChevronUp, SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { READING_FONTS } from '../../lib/prefs';
import { flipPages, snapshotPage } from '../../lib/pageFlip';
import { wordAtPoint, wordRect } from '../../lib/spokenWord';
import { Menu } from '../ui';
import ChapterText from './ChapterText';
import { DocSearch, categoryColor } from './ReaderTools';
import ListenSheet from './ListenSheet';

const PAD = 22; // horizontal page margin (px)
const GAP = PAD * 2; // column gap, wide enough that neighbouring pages never peek in
const TAP_ZONE = 0.28;

const PAPERS = [
  ['white', 'White'],
  ['paper', 'Paper'],
  ['sepia', 'Sepia'],
  ['night', 'Dark'],
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// One tap re-types the whole page: the DK-encyclopedia look (bold sans, justified, tight rhythm) or a classic serif novel
const STYLE_PRESETS = {
  encyclopedia: { bookStyle: 'encyclopedia', font: 'sourcesans', fontSize: 17, lineHeight: 1.42, align: 'justify' },
  classic: { bookStyle: 'classic', font: 'serif', fontSize: 18, lineHeight: 1.75, align: 'left' },
};

// ─── Display settings (Text · Lighting) ───────────────────────────────────────
function DisplaySheet({ onClose }) {
  const { prefs, setPrefs } = useApp();
  const r = prefs.reading;
  const [tab, setTab] = useState('text');
  const set = (patch) => setPrefs({ reading: patch });
  const pct = (v, base) => `${Math.round((v / base) * 100)}%`;
  return (
    <div className="mr-sheet mr-display" role="dialog" aria-label="Display settings">
      <div className="mr-tabs" role="tablist">
        {[['text', 'Text'], ['light', 'Lighting']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="mr-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      {tab === 'text' ? (
        <div className="mr-sheet-body">
          <div className="mr-row">
            <span>Page style</span>
            <select value={r.bookStyle || 'classic'} onChange={(e) => set(STYLE_PRESETS[e.target.value])} aria-label="Page style">
              <option value="encyclopedia">Encyclopedia</option>
              <option value="classic">Classic novel</option>
            </select>
          </div>
          <div className="mr-fonts" role="radiogroup" aria-label="Typeface">
            {Object.entries(READING_FONTS).map(([id, f]) => (
              <button key={id} role="radio" aria-checked={r.font === id} className={r.font === id ? 'chosen' : ''} onClick={() => set({ font: id })}>
                <span style={{ fontFamily: f.css }}>A</span>
                <small>{f.label}</small>
              </button>
            ))}
          </div>
          <div className="mr-stepper">
            <button onClick={() => set({ fontSize: Math.max(13, r.fontSize - 1) })} disabled={r.fontSize <= 13} aria-label="Smaller text"><span className="sm">T</span></button>
            <output>{pct(r.fontSize, 18)}</output>
            <button onClick={() => set({ fontSize: Math.min(30, r.fontSize + 1) })} disabled={r.fontSize >= 30} aria-label="Larger text"><span className="lg">T</span></button>
          </div>
          <div className="mr-stepper">
            <button onClick={() => set({ lineHeight: Math.max(1.3, +(r.lineHeight - 0.1).toFixed(2)) })} disabled={r.lineHeight <= 1.3} aria-label="Tighter lines">≡−</button>
            <output>{pct(r.lineHeight, 1.75)}</output>
            <button onClick={() => set({ lineHeight: Math.min(2.4, +(r.lineHeight + 0.1).toFixed(2)) })} disabled={r.lineHeight >= 2.4} aria-label="Looser lines">≡+</button>
          </div>
          <div className="mr-row">
            <span>Alignment</span>
            <select value={r.align} onChange={(e) => set({ align: e.target.value })} aria-label="Alignment">
              <option value="left">Left</option>
              <option value="justify">Justified</option>
            </select>
          </div>
          <div className="mr-row">
            <span>Page turn</span>
            <select value={r.pageTurn || 'flip'} onChange={(e) => set({ pageTurn: e.target.value })} aria-label="Page turn animation">
              <option value="flip">Page flip</option>
              <option value="slide">Slide</option>
              <option value="fade">Fade</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="mr-sheet-body">
          <div className="mr-row">
            <strong>Reading brightness</strong>
            <button role="switch" aria-checked={r.brightnessOn} className={`mr-switch ${r.brightnessOn ? 'on' : ''}`} onClick={() => set({ brightnessOn: !r.brightnessOn })} aria-label="Reading brightness"><i /></button>
          </div>
          <input type="range" className="mr-range" min={30} max={100} value={r.brightness} disabled={!r.brightnessOn} aria-label="Brightness"
            style={{ '--fill': `${((r.brightness - 30) / 70) * 100}%` }} onChange={(e) => set({ brightness: +e.target.value })} />
          <strong className="mr-label">Viewing theme</strong>
          <div className="mr-themes" role="radiogroup" aria-label="Viewing theme">
            {PAPERS.map(([id, label]) => (
              <button key={id} role="radio" aria-checked={r.paper === id} className={`mr-theme theme-${id} ${r.paper === id ? 'chosen' : ''}`} onClick={() => set({ paper: id })} aria-label={label}>
                {r.paper === id ? '✓' : ''}
              </button>
            ))}
          </div>
          <div className="mr-row">
            <strong>Reading Night Light</strong>
            <button role="switch" aria-checked={r.nightLight} className={`mr-switch ${r.nightLight ? 'on' : ''}`} onClick={() => set({ nightLight: !r.nightLight })} aria-label="Night light"><i /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Contents · Bookmarks · Highlights ────────────────────────────────────────
function ContentsSheet({ doc, chapterIndex, bookmarks, highlights, onGo, onDeleteBookmark, onClose }) {
  const [tab, setTab] = useState('contents');
  const curRef = useRef(null);
  useEffect(() => { curRef.current?.scrollIntoView({ block: 'center' }); }, [tab]);
  return (
    <div className="mr-sheet mr-contents" role="dialog" aria-label="Contents">
      <div className="mr-tabs" role="tablist">
        {[['contents', 'Contents'], ['bookmarks', `Bookmarks${bookmarks.length ? ` · ${bookmarks.length}` : ''}`], ['highlights', `Highlights${highlights.length ? ` · ${highlights.length}` : ''}`]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="mr-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="mr-list">
        {tab === 'contents' && doc.chapters.map((ch) => (
          <button key={ch.index} ref={ch.index === chapterIndex ? curRef : undefined} className={ch.index === chapterIndex ? 'current' : ''} onClick={() => onGo(ch.index, {})}>
            <span className="num">{String(ch.index + 1).padStart(2, '0')}</span>
            <span className="txt">{ch.title}</span>
            <small>{ch.minutes}m</small>
          </button>
        ))}
        {tab === 'bookmarks' && (bookmarks.length === 0
          ? <p className="mr-empty">No bookmarks yet. Open the ⋯ menu on a page to add one.</p>
          : bookmarks.map((b) => (
            <div key={b.id} className="mr-list-row">
              <button onClick={() => onGo(b.chapter_index, { ratio: b.scroll_ratio })}>
                <Bookmark size={14} /><span className="txt">{b.label}<small>Section {b.chapter_index + 1}</small></span>
              </button>
              <button className="del" onClick={() => onDeleteBookmark(b)} aria-label="Delete bookmark"><Trash2 size={14} /></button>
            </div>
          )))}
        {tab === 'highlights' && (highlights.length === 0
          ? <p className="mr-empty">Press and hold a word, then choose Highlight.</p>
          : highlights.map((h) => (
            <button key={h.id} className={`hl-row hl-${categoryColor(h.category)}`} onClick={() => onGo(h.chapter_index, { find: h.text.slice(0, 40) })}>
              <i />
              <span className="txt">“{h.text.length > 110 ? `${h.text.slice(0, 110)}…` : h.text}”<small>{h.category} · section {h.chapter_index + 1}{h.note ? ` · ${h.note}` : ''}</small></span>
            </button>
          )))}
      </div>
    </div>
  );
}

// ─── The reader ───────────────────────────────────────────────────────────────
export default function MobileReader({
  doc, chapter, chapterIndex, chapterLoading, highlights, allHighlights, searchQuery, setSearchQuery, searchOpen, setSearchOpen,
  bookmarks, onToggleBookmark, onDeleteBookmark, onHighlightClick, goChapter, setMode,
  surfaceRef, articleRef, ratioRef, pendingScroll, pendingFind, saveProgress, lastActivity,
  narrator, listen, startListening, segMeta, onWordTap, lang = 'en', onOverview, languageToggle, offlineMode, saveOffline, downloadOriginal, navigate, openAI, notify, children,
}) {
  const { prefs } = useApp();
  const r = prefs.reading;
  const anim = prefs.accessibility.reducedMotion ? 'none' : (r.pageTurn || 'flip');
  const dk = r.bookStyle === 'encyclopedia';

  const viewportRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [instant, setInstant] = useState(true);
  const [tick, setTick] = useState(0);
  const leafHost = useRef(null);
  const flipRun = useRef(null);
  const [chrome, setChrome] = useState(true); // toolbars are visible on entering the reader, like other PDF/document readers
  const [sheet, setSheet] = useState(null); // 'display' | 'contents' | 'listen'
  const [scrub, setScrub] = useState(null);
  const lastChapter = useRef(null);
  const lastKey = useRef('');

  // ─── Measure the page area ────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => setDims({ w: Math.floor(el.clientWidth - PAD * 2), h: Math.floor(el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const step = dims.w + GAP;
  const flowEl = () => articleRef.current;

  /** Page that contains a DOM rect/range, relative to the flow's own (translated) origin. */
  const pageOfRect = useCallback((rect) => {
    const flow = flowEl();
    if (!flow || !rect) return 0;
    return Math.max(0, Math.floor((rect.left - flow.getBoundingClientRect().left + 2) / step));
  }, [step]); // eslint-disable-line

  const pageOfNeedle = useCallback((needle) => {
    const flow = flowEl();
    if (!flow || !needle) return null;
    const low = needle.toLowerCase();
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.toLowerCase().indexOf(low);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      return { page: pageOfRect(rect), el: node.parentElement?.closest('[data-p]') };
    }
    const p = [...flow.querySelectorAll('[data-p]')].find((n) => n.textContent.toLowerCase().includes(low));
    return p ? { page: pageOfRect(p.getClientRects()[0]), el: p } : null;
  }, [pageOfRect]); // eslint-disable-line

  // ─── Paginate (and land on the right page) ────────────────────────────────
  const typography = `${r.font}|${r.fontSize}|${r.lineHeight}|${r.paragraphSpacing}|${r.align}`;
  useLayoutEffect(() => {
    const flow = flowEl();
    if (!chapter || !flow || !dims.w || !dims.h) return;
    const count = Math.max(1, Math.round((flow.scrollWidth + GAP) / step));
    setPages(count);

    const fresh = lastChapter.current !== chapter;
    lastChapter.current = chapter;
    if (fresh) {
      setInstant(true);
      const find = pendingFind.current;
      const ratio = pendingScroll.current ?? 0;
      pendingFind.current = null;
      pendingScroll.current = null;
      let target = ratio >= 0.995 ? count - 1 : Math.floor(ratio * count + 0.001);
      if (find) {
        const hit = pageOfNeedle(find);
        if (hit) {
          target = hit.page;
          if (hit.el) { hit.el.classList.add('flash'); setTimeout(() => hit.el.classList.remove('flash'), 1600); }
        }
      }
      setPage(clamp(target, 0, count - 1));
    } else if (lastKey.current !== `${typography}|${dims.w}x${dims.h}`) {
      setInstant(true);
      setPage(clamp(Math.floor(ratioRef.current * count + 0.001), 0, count - 1)); // keep the reading position
    }
    lastKey.current = `${typography}|${dims.w}x${dims.h}`;
  }, [chapter, dims, typography, step]); // eslint-disable-line

  // web fonts change line breaks after first paint: re-measure once they settle
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setDims((d) => ({ ...d })));
    return () => { live = false; };
  }, [chapter, r.font]);

  useEffect(() => {
    if (!instant) return undefined;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    return () => cancelAnimationFrame(id);
  }, [instant, page, pages]);

  // keep the persisted reading position in sync with the visible page
  useEffect(() => {
    if (!chapter) return;
    ratioRef.current = page / pages;
    lastActivity.current = Date.now();
    saveProgress();
  }, [page, pages]); // eslint-disable-line

  // ─── Turning pages ────────────────────────────────────────────────────────
  const goPage = useCallback((p) => {
    const target = clamp(p, 0, pages - 1);
    if (target === page) return;
    flipRun.current?.finish(); // a new turn settles the previous one first
    setInstant(false);
    setTick((t) => t + 1);

    const flow = flowEl();
    if (anim === 'flip' && Math.abs(target - page) === 1 && leafHost.current && flow) {
      if (target > page) {
        // the page underneath is already the new one; the old page lifts off and turns away
        const face = snapshotPage(flow, page, step);
        setInstant(true);
        setPage(target);
        flipRun.current = flipPages({ host: leafHost.current, face, direction: 1, onDone: () => { flipRun.current = null; } });
      } else {
        // the earlier page swings back over the current one, then becomes the current page
        const face = snapshotPage(flow, target, step);
        flipRun.current = flipPages({ host: leafHost.current, face, direction: -1, onDone: () => { flipRun.current = null; setInstant(true); setPage(target); } });
      }
      return;
    }
    setPage(target);
  }, [pages, page, anim, step]); // eslint-disable-line

  useEffect(() => () => flipRun.current?.finish(), []);
  useEffect(() => { flipRun.current?.finish(); }, [chapter]);

  const turn = useCallback((dir) => {
    if (dir > 0) {
      if (page < pages - 1) goPage(page + 1);
      else if (chapterIndex + 1 < doc.chapter_count) goChapter(chapterIndex + 1, { ratio: 0 });
      else notify('You’ve reached the end of the book');
    } else if (page > 0) goPage(page - 1);
    else if (chapterIndex > 0) goChapter(chapterIndex - 1, { ratio: 1 });
  }, [page, pages, chapterIndex, doc.chapter_count, goPage, goChapter, notify]);

  useEffect(() => {
    const onKey = (e) => {
      if (/input|textarea|select/i.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || sheet) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); turn(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); turn(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, sheet]);

  // swipe + tap zones
  const touch = useRef(null);
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, at: Date.now() }; };
  const onTouchEnd = (e) => {
    const s = touch.current;
    touch.current = null;
    if (!s || window.getSelection()?.toString()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - s.at < 700) {
      e.preventDefault();
      setChrome(false);
      turn(dx < 0 ? 1 : -1);
    }
  };
  const onClick = (e) => {
    if (e.target.closest('[data-hl], a, button, .selection-toolbar, .popover')) return;
    if (window.getSelection()?.toString()) return;
    if (chrome || sheet) { setChrome(false); setSheet(null); return; }
    const x = e.clientX / window.innerWidth;
    if (x < TAP_ZONE) turn(-1);
    else if (x > 1 - TAP_ZONE) turn(1);
    else {
      // centre of the page: a word opens "Read aloud from here" (or jumps there while listening); empty space shows the toolbars
      const hit = onWordTap && wordAtPoint(e.clientX, e.clientY, flowEl());
      if (hit) onWordTap(hit); else setChrome(true); // chrome is hidden here (a tap while shown returns above), so this brings it back
    }
  };

  // follow the narrator word by word, turning the page when the spoken word moves onto the next one
  const pageRef = useRef(0);
  pageRef.current = page;
  useEffect(() => narrator.on((s) => {
    if (!s.playing) return;
    const m = segMeta.current[s.segment];
    const rect = m && wordRect(flowEl(), m.p, m.start + (s.charIndex || 0));
    if (!rect) return;
    const p = pageOfRect(rect);
    if (p !== pageRef.current) goPage(p);
  }), [narrator, pageOfRect, goPage]); // eslint-disable-line

  // ─── Derived progress ─────────────────────────────────────────────────────
  const progress = useMemo(() => {
    const weights = doc.chapters.map((c) => Math.max(1, c.word_count || c.minutes || 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const before = weights.slice(0, chapterIndex).reduce((a, b) => a + b, 0);
    const pagesPerWeight = pages / weights[chapterIndex];
    const totalPages = Math.max(pages, Math.round(total * pagesPerWeight));
    const frac = (before + weights[chapterIndex] * (page / pages)) / total;
    return { weights, total, before, totalPages, frac, globalPage: clamp(Math.round(frac * totalPages) + 1, 1, totalPages) };
  }, [doc.chapters, chapterIndex, page, pages]);

  const commitScrub = (value) => {
    setScrub(null);
    const pos = ((value - 1) / progress.totalPages) * progress.total;
    let acc = 0;
    let ci = 0;
    for (; ci < progress.weights.length - 1; ci++) {
      if (pos < acc + progress.weights[ci]) break;
      acc += progress.weights[ci];
    }
    const ratio = clamp((pos - acc) / progress.weights[ci], 0, 1);
    if (ci === chapterIndex) goPage(Math.floor(ratio * pages));
    else goChapter(ci, { ratio });
  };

  const pagesLeft = pages - page - 1;
  const leftLabel = pagesLeft <= 0 ? 'Last page of chapter' : `${pagesLeft} page${pagesLeft === 1 ? '' : 's'} left in chapter`;
  const percent = Math.round(progress.frac * 100);

  // ─── Bookmark helpers ─────────────────────────────────────────────────────
  const existingBookmark = bookmarks.find((b) => b.chapter_index === chapterIndex && Math.abs(b.scroll_ratio - page / pages) < 0.5 / pages + 0.001);
  const firstVisibleParagraph = () => {
    const flow = flowEl();
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!flow || !vp) return null;
    return [...flow.querySelectorAll('[data-p]')].find((n) => [...n.getClientRects()].some((rc) => rc.right > vp.left + PAD && rc.left < vp.right - PAD && rc.bottom > vp.top)) || null;
  };
  const toggleBookmark = () => {
    const p = firstVisibleParagraph();
    onToggleBookmark({ existing: existingBookmark, label: (p?.textContent || chapter?.title || 'Bookmark').split(/\s+/).slice(0, 9).join(' ') });
  };
  const listenHere = () => {
    const p = firstVisibleParagraph();
    setSheet('listen');
    if (!narrator.script.length || !narrator.playing) startListening(p ? Number(p.dataset.p) : 0);
  };

  const goFromSheet = (index, opts) => { setSheet(null); setChrome(false); goChapter(index, opts); };
  const meta = doc.chapters?.[chapterIndex];
  const title = chapter?.title || meta?.title || '';

  const flowStyle = {
    '--read-font': READING_FONTS[r.font]?.css,
    '--read-size': `${r.fontSize}px`,
    '--read-lh': r.lineHeight,
    '--read-gap': `${r.paragraphSpacing}em`,
    '--read-align': r.align,
    width: dims.w || undefined,
    height: dims.h || undefined,
    columnWidth: dims.w || undefined,
    columnGap: GAP,
    transform: `translate3d(${-page * step}px, 0, 0)`,
    transition: instant || anim !== 'slide' ? 'none' : undefined,
  };

  return (
    <div className={`mobile-reader paper-${r.paper} ${dk ? 'book-dk' : ''} ${chrome ? 'chrome-on' : ''}`} ref={surfaceRef}>
      {dk && <span className="mr-rule" aria-hidden="true" />}
      {dk && (
        <div className="mr-runhead" aria-hidden="true">
          <b className="num">{progress.globalPage}</b>
          <span className="tag">{(doc.tags?.[0] || doc.type || 'reading').toLowerCase()}</span>
          <b className="topic">◆ {(doc.title || '').toUpperCase()}</b>
        </div>
      )}
      <div className="mr-page" ref={viewportRef} onClick={onClick} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        onScroll={(e) => { e.currentTarget.scrollLeft = 0; }}>
        <div ref={articleRef} className={`mr-flow anim-${anim} ${anim === 'fade' ? (tick % 2 ? 'tick-a' : 'tick-b') : ''}`} lang={lang} style={flowStyle} aria-busy={chapterLoading}>
          {chapter && (
            <>
              <h2 className="mr-title">{title}</h2>
              <ChapterText content={chapter.content} highlights={highlights} query={searchOpen ? searchQuery : ''}
                activeParagraph={listen.playing ? listen.paragraph : null} onHighlightClick={onHighlightClick}
                dropcap={!dk && lang === 'en'} lead={dk} />
            </>
          )}
        </div>
        {existingBookmark && <span key={existingBookmark.id} className="bm-ribbon mr-ribbon" role="img" aria-label="Bookmarked" />}
      </div>
      <div className="mr-leafhost" ref={leafHost} aria-hidden="true" />

      <footer className="mr-foot" aria-live="off">
        <span>{leftLabel}</span>
        <span>{percent}%</span>
      </footer>

      {listen.playing && sheet !== 'listen' && (
        <button className="mr-nowplaying" onClick={() => setSheet('listen')} aria-label="Open player">
          <AudioLines size={14} /> <span>Listening · tap to open</span>
        </button>
      )}

      {!sheet && !searchOpen && (
        <button className="mr-toggle" onClick={() => setChrome((c) => !c)}
          aria-label={chrome ? 'Hide reader tools' : 'Show reader tools'} aria-pressed={chrome} title={chrome ? 'Hide tools' : 'Show tools'}>
          {chrome ? <ChevronUp size={18} /> : <SlidersHorizontal size={17} />}
        </button>
      )}

      {/* top chrome */}
      <header className="mr-bar mr-top" aria-hidden={!chrome}>
        <button onClick={() => navigate('/library')} aria-label="Back to library" tabIndex={chrome ? 0 : -1}><ArrowLeft size={20} /></button>
        <span className="mr-doc-title">{doc.title}{offlineMode && <WifiOff size={12} />}</span>
        <button onClick={() => { setSearchOpen(true); setChrome(false); }} aria-label="Search in book" tabIndex={chrome ? 0 : -1}><Search size={19} /></button>
        <button onClick={() => setSheet((s) => (s === 'display' ? null : 'display'))} aria-label="Display settings" aria-expanded={sheet === 'display'} tabIndex={chrome ? 0 : -1}><Type size={20} /></button>
        <button onClick={listenHere} aria-label="Listen" tabIndex={chrome ? 0 : -1}><Headphones size={19} /></button>
        <button onClick={() => openAI({ documentId: doc.id, chapterIndex, nonce: Date.now() })} aria-label="Ask AI" tabIndex={chrome ? 0 : -1}><Sparkles size={19} /></button>
        <Menu label="More" align="right" trigger={<MoreHorizontal size={20} />} items={[
          { label: existingBookmark ? 'Remove bookmark' : 'Bookmark this page', icon: existingBookmark ? BookmarkCheck : Bookmark, onClick: toggleBookmark },
          { label: 'Contents & highlights', icon: List, onClick: () => setSheet('contents') },
          { label: 'Zen mode', icon: Moon, onClick: () => setMode('Zen') },
          { label: 'Vibe mode', icon: AudioLines, onClick: () => setMode('Vibe') },
          '-',
          { label: 'Audio overview in your language', icon: AudioLines, onClick: () => onOverview?.() },
          { label: 'Generate audiobook', icon: Headphones, onClick: () => navigate(`/audio?tab=generate&doc=${doc.id}`) },
          { label: 'Save for offline reading', icon: CloudDownload, onClick: saveOffline, disabled: offlineMode },
          doc.has_file && { label: 'Download original file', icon: Download, onClick: downloadOriginal },
          { label: 'Open notebook', icon: StickyNote, onClick: () => navigate(`/notes?doc=${doc.id}`) },
        ]} />
      </header>

      {/* bottom chrome: contents + page scrubber */}
      <div className="mr-bar mr-bottom" aria-hidden={!chrome}>
        <button onClick={() => setSheet('contents')} aria-label="Contents" tabIndex={chrome ? 0 : -1}><List size={20} /></button>
        {languageToggle}
        <input type="range" className="mr-scrub" min={1} max={progress.totalPages} value={scrub ?? progress.globalPage} aria-label="Page"
          tabIndex={chrome ? 0 : -1} style={{ '--fill': `${(((scrub ?? progress.globalPage) - 1) / Math.max(1, progress.totalPages - 1)) * 100}%` }}
          onChange={(e) => setScrub(+e.target.value)}
          onPointerUp={(e) => scrub != null && commitScrub(+e.currentTarget.value)}
          onKeyUp={(e) => scrub != null && commitScrub(+e.currentTarget.value)}
          onBlur={(e) => scrub != null && commitScrub(+e.currentTarget.value)} />
        <output>{scrub ?? progress.globalPage} / {progress.totalPages}</output>
      </div>

      {searchOpen && (
        <div className="mr-search">
          <DocSearch documentId={doc.id} initialQuery={searchQuery} onQuery={setSearchQuery} onClose={() => { setSearchOpen(false); setSearchQuery(''); }}
            onJump={(m) => {
              if (m.chapter_index === chapterIndex) {
                const hit = pageOfNeedle(`${m.match}${m.after}`.slice(0, 40).replace(/…$/, '')) || pageOfNeedle(m.match);
                if (hit) goPage(hit.page);
              } else goChapter(m.chapter_index, { find: `${m.match}${m.after}`.slice(0, 40).replace(/…$/, '') });
            }} />
        </div>
      )}

      {sheet === 'display' && <DisplaySheet onClose={() => setSheet(null)} />}
      {sheet === 'contents' && (
        <ContentsSheet doc={doc} chapterIndex={chapterIndex} bookmarks={bookmarks} highlights={allHighlights}
          onGo={goFromSheet} onDeleteBookmark={onDeleteBookmark} onClose={() => setSheet(null)} />
      )}
      {sheet === 'listen' && (
        <ListenSheet doc={doc} title={title} narrator={narrator} listen={listen}
          onStart={() => startListening(Number(firstVisibleParagraph()?.dataset.p || 0))}
          onContents={() => setSheet('contents')} onClose={() => setSheet(null)}
          onBookmark={toggleBookmark} bookmarked={!!existingBookmark}
          moreItems={[
            { label: 'Contents', icon: List, onClick: () => setSheet('contents') },
            { label: 'Audio overview in your language', icon: AudioLines, onClick: () => onOverview?.() },
            { label: 'Generate audiobook', icon: Headphones, onClick: () => navigate(`/audio?tab=generate&doc=${doc.id}`) },
            { label: 'Back to the page', icon: BookOpen, onClick: () => setSheet(null) },
          ]} />
      )}

      {r.brightnessOn && <div className="mr-dim" style={{ opacity: 1 - r.brightness / 100 }} aria-hidden="true" />}
      {r.nightLight && <div className="mr-night" aria-hidden="true" />}
      {children}
    </div>
  );
}
