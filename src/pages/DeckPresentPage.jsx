// ─── Slideshow & presenter view ───────────────────────────────────────────────────────────────────────
// /present/:deckId?mode=show       full-screen audience view
// /present/:deckId?mode=presenter  notes, next-slide preview, timer and accessibility controls; drives any open audience window
// Both windows stay in step through a BroadcastChannel (see useDeckPlayer).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Captions, ChevronLeft, ChevronRight, Contrast, ExternalLink, Layers, Maximize2, Minimize2, MonitorPlay, MousePointer2, Pause, Play, RotateCcw,
  ScreenShare, Square, Timer, Type, Volume2, VolumeX, X, Zap, ZapOff,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { useDeckPlayer, useReducedMotion } from '../hooks/useDeckPlayer';
import { LAYOUT_LABEL } from '../lib/deckThemes';
import { PageLoader } from '../components/ui';
import SlideView, { ScaledFrame, SLIDE_H, SLIDE_W } from '../components/deck/SlideStage';

const A11Y_KEY = 'readvibe.deck.a11y';
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const clock = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const readA11y = () => { try { return JSON.parse(localStorage.getItem(A11Y_KEY)) || {}; } catch { return {}; } };

/** Where the 16:9 slide sits inside a box, so the laser pointer means the same spot in every window. */
function slideRect(box) {
  const r = box.getBoundingClientRect();
  const s = Math.min(r.width / SLIDE_W, r.height / SLIDE_H);
  const w = SLIDE_W * s; const h = SLIDE_H * s;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

const HELP = [
  ['→  Space  PgDn', 'Next build / slide'], ['←  PgUp', 'Previous'], ['Home  End', 'First / last slide'], ['B  .', 'Blackout the screen'],
  ['L', 'Laser pointer'], ['F', 'Full screen'], ['A', 'Animated builds on / off'], ['H', 'High contrast'], ['M', 'Motion on / off'],
  ['+  −  (presenter)', 'Notes text larger / smaller'], ['S  (presenter)', 'Read the notes aloud'], ['C  (presenter)', 'Live captions'], ['?', 'This help'],
];

export default function DeckPresentPage() {
  const { deckId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { authStatus, notify } = useApp();
  const presenter = params.get('mode') === 'presenter';
  const deck = useQuery(() => api.decks.get(deckId), [deckId], { enabled: authStatus === 'authed' });
  const slides = deck.data?.slides || [];
  const p = useDeckPlayer(slides, { channel: `readvibe-deck-${deckId}` });
  const osReduced = useReducedMotion();

  const [a11y, setA11y] = useState(() => ({ contrast: false, still: false, speak: false, notesSize: 20, ...readA11y() }));
  const [help, setHelp] = useState(false);
  const [full, setFull] = useState(false);
  const [chrome, setChrome] = useState(true); // show-mode controls, auto-hidden
  const [laserOn, setLaserOn] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [timer, setTimer] = useState({ running: false, elapsed: 0, target: 0 });
  const stageBox = useRef(null);
  const hideTimer = useRef(null);
  const touch = useRef(null);

  const setA = (patch) => setA11y((a) => { const n = { ...a, ...patch }; try { localStorage.setItem(A11Y_KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const animate = !osReduced && !a11y.still;
  const slide = p.slide;
  const nextSlide = slides[p.index + 1];

  // ─── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!timer.running) return undefined;
    const t = setInterval(() => setTimer((s) => ({ ...s, elapsed: s.elapsed + 1 })), 1000);
    return () => clearInterval(t);
  }, [timer.running]);
  const advance = useCallback((dir) => {
    if (dir > 0) p.next(); else p.prev();
    if (presenter && dir > 0) setTimer((s) => (s.running ? s : { ...s, running: true })); // the clock starts with the first advance
  }, [p, presenter]);

  // ─── Read the notes aloud ───────────────────────────────────────────────────
  const speakNotes = useCallback((text) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    if (text) { const u = new SpeechSynthesisUtterance(text); u.lang = navigator.language; synth.speak(u); }
  }, []);
  useEffect(() => { if (presenter && a11y.speak && slide) speakNotes(slide.notes); else window.speechSynthesis?.cancel(); }, [p.index, a11y.speak, presenter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // ─── Live captions (presenter's microphone → everyone) ──────────────────────
  useEffect(() => {
    if (!presenter || !captionsOn || !SR) return undefined;
    let alive = true;
    let clear;
    let finalText = '';
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `; else interim += e.results[i][0].transcript;
      }
      finalText = finalText.slice(-240);
      p.setCaption((finalText + interim).slice(-150).trim());
      clearTimeout(clear);
      clear = setTimeout(() => { finalText = ''; p.setCaption(''); }, 5000);
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') { notify('Microphone access is needed for live captions.', 'warning'); setCaptionsOn(false); } };
    rec.onend = () => { if (alive) try { rec.start(); } catch { /* already running */ } };
    try { rec.start(); } catch { /* already running */ }
    return () => { alive = false; clearTimeout(clear); rec.onend = null; rec.stop(); p.setCaption(''); };
  }, [captionsOn, presenter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Fullscreen ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}));

  // ─── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
      const k = e.key;
      if (['ArrowRight', 'PageDown', 'Enter'].includes(k) || (k === ' ' && !/button/i.test(e.target.tagName))) { e.preventDefault(); advance(1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); advance(-1); }
      else if (k === 'Home') p.goto(0);
      else if (k === 'End') p.goto(slides.length - 1);
      else if (k === 'b' || k === 'B' || k === '.') p.setBlackout(!p.blackout);
      else if (k === 'l' || k === 'L') { setLaserOn((v) => { if (v) p.setLaser(null); return !v; }); }
      else if (k === 'f' || k === 'F') toggleFull();
      else if (k === 'a' || k === 'A') p.setBuilds(!p.builds);
      else if (k === 'h' || k === 'H') setA({ contrast: !a11y.contrast });
      else if (k === 'm' || k === 'M') setA({ still: !a11y.still });
      else if (k === '?' ) setHelp((h) => !h);
      else if (k === 'Escape') setHelp(false);
      else if (presenter && (k === '+' || k === '=')) setA({ notesSize: Math.min(44, a11y.notesSize + 2) });
      else if (presenter && (k === '-' || k === '_')) setA({ notesSize: Math.max(14, a11y.notesSize - 2) });
      else if (presenter && (k === 's' || k === 'S')) setA({ speak: !a11y.speak });
      else if (presenter && (k === 'c' || k === 'C')) setCaptionsOn((v) => !v);
      else if (presenter && (k === 't' || k === 'T')) setTimer((s) => ({ ...s, running: false, elapsed: 0 }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ─── Pointer: laser, auto-hide controls, swipe ──────────────────────────────
  const onMove = (e) => {
    if (!presenter) { setChrome(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setChrome(false), 2600); }
    if (laserOn && stageBox.current) {
      const r = slideRect(stageBox.current);
      const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
      p.setLaser(x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null);
    }
  };
  useEffect(() => { if (!presenter) { hideTimer.current = setTimeout(() => setChrome(false), 3500); } return () => clearTimeout(hideTimer.current); }, [presenter]);

  if (authStatus === 'loading') return <div className="boot"><PageLoader label="Opening…" /></div>;
  if (authStatus === 'anon') return <Navigate to="/login" replace state={{ from: location }} />;
  if (deck.error) return <div className="dk-present-msg"><p>{deck.error.message || 'Could not open this presentation.'}</p><button className="secondary-button" onClick={() => navigate('/decks')}>Back to presentations</button></div>;
  if (!deck.data) return <div className="boot"><PageLoader label="Opening presentation…" /></div>;
  if (deck.data.status !== 'ready' || !slide) return <div className="dk-present-msg"><p>This presentation isn’t ready yet.</p><button className="secondary-button" onClick={() => navigate('/decks')}>Back</button></div>;

  const theme = deck.data.theme;
  const view = (s, step, extra = {}) => (
    <SlideView key={`${s.id}`} slide={s} theme={theme} step={step} animate={animate} highContrast={a11y.contrast} deckTitle={deck.data.title} {...extra} />
  );
  const laser = p.laser && (
    <i className="dk-laser" style={{ left: `${p.laser.x * 100}%`, top: `${p.laser.y * 100}%` }} aria-hidden="true" />
  );
  const announce = `Slide ${p.index + 1} of ${p.total}: ${slide.title}. ${slide.alt || ''}`;
  const over = timer.target > 0 ? timer.elapsed / (timer.target * 60) : 0;

  const controls = (
    <div className="dk-controls">
      <button className="dk-ctl" onClick={() => advance(-1)} disabled={p.index === 0 && (p.step === 0 || p.step === Infinity)} aria-label="Previous"><ChevronLeft size={20} /></button>
      <span className="dk-count" aria-hidden="true">{p.index + 1} / {p.total}</span>
      <button className="dk-ctl" onClick={() => advance(1)} aria-label="Next"><ChevronRight size={20} /></button>
      <span className="dk-sep" />
      <button className={`dk-ctl ${p.blackout ? 'on' : ''}`} onClick={() => p.setBlackout(!p.blackout)} aria-pressed={p.blackout} aria-label="Blackout" title="Blackout (B)"><Square size={17} fill="currentColor" /></button>
      <button className={`dk-ctl ${laserOn ? 'on' : ''}`} onClick={() => setLaserOn((v) => { if (v) p.setLaser(null); return !v; })} aria-pressed={laserOn} aria-label="Laser pointer" title="Laser pointer (L)"><MousePointer2 size={17} /></button>
      <button className={`dk-ctl ${p.builds ? 'on' : ''}`} onClick={() => p.setBuilds(!p.builds)} aria-pressed={p.builds} aria-label="Animated builds" title="Reveal points one at a time (A)">{p.builds ? <Layers size={17} /> : <Layers size={17} opacity=".5" />}</button>
      <button className={`dk-ctl ${a11y.contrast ? 'on' : ''}`} onClick={() => setA({ contrast: !a11y.contrast })} aria-pressed={a11y.contrast} aria-label="High contrast" title="High contrast (H)"><Contrast size={17} /></button>
      <button className={`dk-ctl ${a11y.still || osReduced ? 'on' : ''}`} onClick={() => setA({ still: !a11y.still })} aria-pressed={a11y.still} disabled={osReduced} aria-label="Reduce motion" title="Reduce motion (M)">{animate ? <Zap size={17} /> : <ZapOff size={17} />}</button>
      <button className="dk-ctl" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title="Full screen (F)">{full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      <button className="dk-ctl" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Shortcuts (?)">?</button>
    </div>
  );

  // ─── Audience view ──────────────────────────────────────────────────────────
  if (!presenter) {
    return (
      <div className={`dk-present ${chrome ? 'chrome' : ''}`} onMouseMove={onMove}
        onClick={(e) => { if (!e.target.closest('.dk-controls, .dk-help, .dk-exit')) advance(1); }}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - (touch.current ?? 0); if (Math.abs(dx) > 50) advance(dx < 0 ? 1 : -1); }}>
        <div className="dk-live" aria-live="polite" role="status">{announce}</div>
        <div className="dk-stage-full" ref={stageBox}>
          <ScaledFrame contain>{view(slide, p.step, { index: p.index, total: p.total })}{laser}</ScaledFrame>
        </div>
        {p.caption && <div className="dk-caption" aria-live="off">{p.caption}</div>}
        {p.blackout && <div className="dk-blackout" onClick={() => p.setBlackout(false)} role="button" aria-label="Screen is blank. Press B to resume." />}
        <div className="dk-progress" aria-hidden="true"><i style={{ width: `${((p.index + (p.step === Infinity ? 1 : 0)) / Math.max(1, p.total - 1)) * 100}%` }} /></div>
        <button className="dk-exit" onClick={() => (window.opener ? window.close() : navigate(`/decks/${deckId}`))} aria-label="Exit slideshow"><X size={18} /></button>
        {controls}
        {help && <Help onClose={() => setHelp(false)} />}
      </div>
    );
  }

  // ─── Presenter view ─────────────────────────────────────────────────────────
  return (
    <div className="dk-presenter">
      <div className="dk-live" aria-live="polite" role="status">{announce}</div>
      <header className="dkp-top">
        <strong>{deck.data.title}</strong>
        <span className="dkp-pill">{LAYOUT_LABEL[slide.layout]} · slide {p.index + 1} of {p.total}</span>
        <span className="dkp-spacer" />
        <button className="secondary-button small" onClick={() => window.open(`/present/${deckId}?mode=show`, 'dk-audience', 'popup,width=1280,height=720')}><ScreenShare size={14} /> Open audience window</button>
        <button className="secondary-button small" onClick={() => navigate(`/decks/${deckId}`)}><ExternalLink size={14} /> Editor</button>
      </header>

      <main className="dkp-grid">
        <section className="dkp-current" aria-label="Current slide">
          <div ref={stageBox} className="dkp-stage" onMouseMove={onMove} onMouseLeave={() => laserOn && p.setLaser(null)} style={laserOn ? { cursor: 'crosshair' } : undefined}>
            <ScaledFrame>{view(slide, p.step, { index: p.index, total: p.total })}{laser}{p.blackout && <div className="dk-blackout inline" />}</ScaledFrame>
          </div>
          {p.caption && <div className="dk-caption inline">{p.caption}</div>}
          {controls}
        </section>

        <aside className="dkp-side">
          <section className="dkp-card" aria-label="Next slide">
            <span className="eyebrow">UP NEXT</span>
            {nextSlide ? <ScaledFrame>{view(nextSlide, Infinity, { animate: false })}</ScaledFrame> : <p className="muted small">End of the presentation.</p>}
            {nextSlide && <small className="dkp-next-title">{nextSlide.title}</small>}
          </section>

          <section className="dkp-card dkp-notes" aria-label="Speaker notes">
            <div className="dkp-card-head">
              <span className="eyebrow">SPEAKER NOTES</span>
              <span className="dkp-tools">
                <button className="icon-ghost sm" onClick={() => setA({ notesSize: Math.max(14, a11y.notesSize - 2) })} aria-label="Smaller notes"><Type size={12} /></button>
                <button className="icon-ghost sm" onClick={() => setA({ notesSize: Math.min(44, a11y.notesSize + 2) })} aria-label="Larger notes"><Type size={17} /></button>
                <button className={`icon-ghost sm ${a11y.speak ? 'on' : ''}`} onClick={() => setA({ speak: !a11y.speak })} aria-pressed={a11y.speak} aria-label="Read notes aloud" title="Read notes aloud (S)">{a11y.speak ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
              </span>
            </div>
            <div className="dkp-notes-text" style={{ fontSize: a11y.notesSize }} tabIndex={0}>{slide.notes || <span className="muted">No notes for this slide.</span>}</div>
          </section>

          <section className="dkp-card dkp-timer" aria-label="Timer">
            <div className="dkp-card-head"><span className="eyebrow"><Timer size={11} /> TIMER</span>
              <span className="dkp-tools">
                <button className="icon-ghost sm" onClick={() => setTimer((s) => ({ ...s, running: !s.running }))} aria-label={timer.running ? 'Pause timer' : 'Start timer'}>{timer.running ? <Pause size={14} /> : <Play size={14} />}</button>
                <button className="icon-ghost sm" onClick={() => setTimer((s) => ({ ...s, running: false, elapsed: 0 }))} aria-label="Reset timer"><RotateCcw size={14} /></button>
              </span>
            </div>
            <div className={`dkp-clock ${over >= 1 ? 'over' : over >= 0.8 ? 'warn' : ''}`}>{clock(timer.elapsed)}</div>
            <label className="dkp-target">Target <input type="number" min="0" max="240" value={timer.target || ''} placeholder="min" onChange={(e) => setTimer((s) => ({ ...s, target: Math.max(0, +e.target.value || 0) }))} /> min</label>
            {timer.target > 0 && <div className="dkp-bar"><i style={{ width: `${Math.min(100, over * 100)}%` }} className={over >= 1 ? 'over' : over >= 0.8 ? 'warn' : ''} /></div>}
          </section>

          <section className="dkp-card" aria-label="Accessibility">
            <span className="eyebrow">ACCESSIBILITY</span>
            <button className={`dkp-toggle ${captionsOn ? 'on' : ''}`} onClick={() => (SR ? setCaptionsOn((v) => !v) : notify('Live captions need Chrome or Edge.', 'warning'))} aria-pressed={captionsOn}><Captions size={15} /> Live captions from my microphone</button>
            <button className="dkp-toggle" onClick={() => setHelp(true)}><MonitorPlay size={15} /> Keyboard shortcuts</button>
          </section>
        </aside>

        <nav className="dkp-strip" aria-label="Jump to slide">
          {slides.map((s, i) => (
            <button key={s.id} className={i === p.index ? 'on' : ''} onClick={() => p.goto(i)} aria-label={`Slide ${i + 1}: ${s.title}`} aria-current={i === p.index}>
              <ScaledFrame><SlideView slide={s} theme={theme} animate={false} highContrast={a11y.contrast} /></ScaledFrame><span>{i + 1}</span>
            </button>
          ))}
        </nav>
      </main>
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

function Help({ onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="dk-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dk-help-card">
        <h3>Keyboard shortcuts</h3>
        <dl>{HELP.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        <button ref={ref} className="primary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
