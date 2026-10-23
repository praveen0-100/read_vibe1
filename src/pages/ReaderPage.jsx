// ─── Reader workspace: Reader · Zen · Vibe ───────────────────────────────────
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, AudioLines, BookmarkCheck, Bookmark as BookmarkIcon, BookOpen, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, CloudDownload, Download, Headphones, List, Loader2, Moon, MoreHorizontal, Pause, Play, Search, Sparkles,
  StickyNote, Trash2, Type, WifiOff, X,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { useIsMobile } from '../hooks/useMediaQuery';
import { AmbientEngine } from '../lib/ambient';
import { formatMinutes } from '../lib/format';
import { offline } from '../lib/offline';
import { READING_FONTS, READING_WIDTHS } from '../lib/prefs';
import { loadVoices, Narrator, pickVoice, pickVoiceForLang, speak, speechSupported } from '../lib/speech';
import { chunkAtSpaces, detectLanguage, SENTENCE_RE, speechTag } from '../lib/languages';
import { findSpeakers, splitParagraph, stripDirections } from '../lib/stageDirections';
import { useNaturalVoice } from '../hooks/useNaturalVoice';
import OverviewLauncher from '../components/audio/OverviewLauncher';
import OverviewSheet from '../components/audio/OverviewSheet';
import { clearSpokenWord, showSpokenWord, wordAtPoint } from '../lib/spokenWord';
import { VibePlayer } from '../lib/vibeMusic';
import { EmptyState, ErrorState, Field, Menu, Modal, PageLoader, ProgressBar } from '../components/ui';
import ChapterText, { splitParagraphs } from '../components/reader/ChapterText';
import MobileReader from '../components/reader/MobileReader';
import { DocSearch, HighlightPopover, ReaderSettings, SelectionToolbar, WordMenu, categoryColor } from '../components/reader/ReaderTools';
import { VibeVisualizer, VIBE_PRESETS, ZEN_PRESETS, ZenBackdrop } from '../components/reader/Scenes';
import VibePanel from '../components/reader/VibePanel';
import ZenPanel, { useFocusTimer } from '../components/reader/ZenPanel';

// pitch offsets (Hz) that keep characters apart when two voices must play several parts
const CAST_SHIFTS = [0, -4, 5, -8, 8, -11];

const MODES = [
  { id: 'Reader', icon: BookOpen },
  { id: 'Zen', icon: Moon },
  { id: 'Vibe', icon: AudioLines },
];

function useMainScroller() {
  return useCallback(() => document.getElementById('main'), []);
}

/** Pick the most recent document when /read has no id. */
function ReadRedirect() {
  const navigate = useNavigate();
  const { setUploadOpen } = useApp();
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), []);
  useEffect(() => {
    const ready = (docs.data || []).filter((d) => d.status === 'ready');
    if (ready.length) navigate(`/read/${ready[0].id}`, { replace: true });
  }, [docs.data, navigate]);
  if (docs.error) return <div className="page-shell"><ErrorState error={docs.error} onRetry={docs.reload} /></div>;
  if (docs.data && !docs.data.some((d) => d.status === 'ready')) {
    return <div className="page-shell"><EmptyState icon={BookOpen} title="Nothing to read yet." description="Upload a document and it will open here." action="Upload document" onAction={() => setUploadOpen(true)} /></div>;
  }
  return <PageLoader label="Opening your last book…" />;
}

export default function ReaderPage() {
  const { docId } = useParams();
  if (!docId) return <ReadRedirect />;
  return <Reader key={docId} docId={docId} />;
}

function Reader({ docId }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { prefs, notify, openAI, confirm, refreshData } = useApp();
  const getScroller = useMainScroller();

  // ─── Document & content ────────────────────────────────────────────────────
  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const offlinePkg = useRef(null);
  const [chapterIndex, setChapterIndex] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const chapterCache = useRef(new Map());
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [mode, setModeState] = useState('Reader');
  // On phones the Reader mode is a paged, book-style view; Zen/Vibe keep the scrolling layout.
  const isMobile = useIsMobile();
  const paged = isMobile && mode === 'Reader';
  const pagedRef = useRef(paged);
  pagedRef.current = paged;
  const pendingScroll = useRef(null); // ratio to restore
  const pendingFind = useRef(params.get('q'));
  const [searchQuery, setSearchQuery] = useState(params.get('q') || '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.documents.get(docId);
        if (cancelled) return;
        if (d.status !== 'ready') { setLoadError({ message: d.status === 'processing' ? 'This document is still being processed. It will open as soon as it’s ready.' : d.error || 'This document could not be processed.' }); return; }
        setDoc(d);
        setModeState(d.last_mode || 'Reader');
        const start = params.get('chapter') != null ? Number(params.get('chapter')) : d.current_chapter;
        pendingScroll.current = params.get('chapter') != null ? 0 : d.scroll_ratio;
        setChapterIndex(Math.min(Math.max(0, start), d.chapter_count - 1));
        api.documents.open(docId).catch(() => {});
        api.documents.highlights(docId).then((h) => !cancelled && setHighlights(h)).catch(() => {});
        api.documents.bookmarks(docId).then((b) => !cancelled && setBookmarks(b)).catch(() => {});
      } catch (err) {
        const pkg = await offline.get(docId).catch(() => null);
        if (cancelled) return;
        if (pkg && (err.isNetwork || err.status >= 500)) {
          offlinePkg.current = pkg;
          setOfflineMode(true);
          setDoc(pkg.document);
          setHighlights(pkg.highlights || []);
          setBookmarks(pkg.bookmarks || []);
          setModeState(pkg.document.last_mode || 'Reader');
          pendingScroll.current = pkg.document.scroll_ratio;
          setChapterIndex(pkg.document.current_chapter || 0);
        } else setLoadError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]); // eslint-disable-line

  const fetchChapter = useCallback(async (index) => {
    if (chapterCache.current.has(index)) return chapterCache.current.get(index);
    let ch;
    if (offlinePkg.current) {
      ch = offlinePkg.current.chapters.find((c) => c.index === index);
    } else {
      try {
        ch = await api.documents.chapter(docId, index);
      } catch (err) {
        const pkg = await offline.get(docId).catch(() => null);
        ch = pkg?.chapters.find((c) => c.index === index);
        if (!ch) throw err;
        setOfflineMode(true);
      }
    }
    chapterCache.current.set(index, ch);
    return ch;
  }, [docId]);

  useEffect(() => {
    if (chapterIndex == null || !doc) return;
    let cancelled = false;
    setChapterLoading(true);
    fetchChapter(chapterIndex)
      .then((ch) => {
        if (cancelled) return;
        setChapter(ch);
        if (chapterIndex + 1 < doc.chapter_count) fetchChapter(chapterIndex + 1).catch(() => {}); // prefetch
      })
      .catch((err) => !cancelled && notify(err.message, 'error'))
      .finally(() => !cancelled && setChapterLoading(false));
    return () => { cancelled = true; };
  }, [chapterIndex, doc, fetchChapter, notify]);

  // ─── Scroll position: restore & track ──────────────────────────────────────
  const articleRef = useRef(null);
  const ratioRef = useRef(0);
  const [docProgress, setDocProgress] = useState(0);
  useEffect(() => { if (doc) setDocProgress(doc.progress); }, [doc]);

  const computeRatio = useCallback(() => {
    const main = getScroller();
    const el = articleRef.current;
    if (!main || !el) return 0;
    const top = el.getBoundingClientRect().top + main.scrollTop - main.getBoundingClientRect().top;
    const h = el.scrollHeight - main.clientHeight * 0.6;
    return Math.max(0, Math.min(1, (main.scrollTop - top + main.clientHeight * 0.25) / Math.max(1, h)));
  }, [getScroller]);

  useLayoutEffect(() => {
    if (!chapter || pagedRef.current) return; // the paged reader restores its own position
    const main = getScroller();
    const el = articleRef.current;
    if (!main || !el) return;
    if (pendingFind.current) {
      const needle = pendingFind.current.toLowerCase();
      const p = [...el.querySelectorAll('[data-p]')].find((n) => n.textContent.toLowerCase().includes(needle));
      pendingFind.current = null;
      if (p) { p.scrollIntoView({ block: 'center' }); p.classList.add('flash'); setTimeout(() => p.classList.remove('flash'), 1600); return; }
    }
    const r = pendingScroll.current ?? 0;
    pendingScroll.current = null;
    const top = el.getBoundingClientRect().top + main.scrollTop - main.getBoundingClientRect().top;
    main.scrollTop = r > 0.01 ? top + r * (el.scrollHeight - main.clientHeight * 0.6) - main.clientHeight * 0.25 : Math.max(0, top - 140);
  }, [chapter, getScroller]);

  const saveTimer = useRef(null);
  const saveProgress = useCallback((immediate = false) => {
    if (!doc || chapterIndex == null || offlineMode) return;
    clearTimeout(saveTimer.current);
    const run = () => api.documents.progress(docId, { chapter_index: chapterIndex, scroll_ratio: Number(ratioRef.current.toFixed(4)), mode })
      .then((r) => setDocProgress(r.progress)).catch(() => {});
    if (immediate) run(); else saveTimer.current = setTimeout(run, 1500);
  }, [doc, chapterIndex, docId, mode, offlineMode]);

  useEffect(() => {
    const main = getScroller();
    if (!main) return undefined;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        ratioRef.current = computeRatio();
        saveProgress();
        lastActivity.current = Date.now();
      });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => { main.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [getScroller, computeRatio, saveProgress]);

  useEffect(() => () => { clearTimeout(saveTimer.current); }, []);
  useEffect(() => { if (chapter) saveProgress(true); }, [chapter, mode]); // eslint-disable-line

  // ─── Reading-session tracking (active, visible time only) ─────────────────
  const lastActivity = useRef(Date.now());
  const sessionSeconds = useRef(0);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); };
    window.addEventListener('pointermove', bump, { passive: true });
    window.addEventListener('keydown', bump);
    const flush = () => {
      const secs = Math.round(sessionSeconds.current);
      if (secs >= 20) {
        api.activity.logSession({ document_id: docId, kind: 'reading', mode: modeRef.current, seconds: secs }).catch(() => {});
        sessionSeconds.current = 0;
      }
    };
    const t = setInterval(() => {
      const active = document.visibilityState === 'visible' && Date.now() - lastActivity.current < 3 * 60 * 1000;
      if (active) { sessionSeconds.current += 1; setTodaySeconds((s) => s + 1); }
      if (sessionSeconds.current >= 120) flush();
    }, 1000);
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(t);
      flush();
      window.removeEventListener('pointermove', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('pagehide', flush);
    };
  }, [docId]);
  const stats = useQuery(() => api.activity.stats(), []);

  // ─── Navigation ────────────────────────────────────────────────────────────
  const goChapter = useCallback((i, { ratio = 0, find = null } = {}) => {
    if (!doc || i < 0 || i >= doc.chapter_count) return;
    pendingScroll.current = ratio;
    pendingFind.current = find;
    ratioRef.current = ratio;
    if (i === chapterIndex) {
      setChapter((c) => (c ? { ...c } : c)); // re-run scroll restore
    } else setChapterIndex(i);
    setTocOpen(false);
    if (params.get('chapter') || params.get('q')) setParams({}, { replace: true });
  }, [doc, chapterIndex, params, setParams]);

  const setMode = (m) => {
    pendingScroll.current = computeRatio();
    setModeState(m);
    setChapter((c) => (c ? { ...c } : c)); // keep reading position across layout change
  };

  // ─── Zen & Vibe audio engines ──────────────────────────────────────────────
  const ambient = useMemo(() => new AmbientEngine(), []);
  const [ambientOn, setAmbientOn] = useState(false);
  const player = useMemo(() => new VibePlayer(), []);
  const [music, setMusic] = useState(() => player.state());
  useEffect(() => player.on(setMusic), [player]);
  useEffect(() => () => { ambient.dispose(); player.dispose(); }, [ambient, player]);
  useEffect(() => {
    if (mode !== 'Zen' && ambientOn) setAmbientOn(false);
    if (mode !== 'Vibe' && player.playing) player.pause();
  }, [mode]); // eslint-disable-line
  const timer = useFocusTimer({ documentId: docId, onPhaseEnd: (phase) => notify(phase === 'focus' ? 'Focus session complete — take a short break.' : 'Break over — back to reading.', 'info') });
  const getLevels = useCallback((n) => player.levels(n), [player]);

  // ─── Read aloud ────────────────────────────────────────────────────────────
  const narrator = useMemo(() => new Narrator(), []);
  const [listen, setListen] = useState({ playing: false, paragraph: null });
  const segParagraphs = useRef([]);
  const voiceRef = useRef(null);
  const nv = useNaturalVoice();
  const deviceVoices = useRef([]);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewLang, setOverviewLang] = useState(null); // null until the user picks one: the dropdown then shows its placeholder
  const openOverview = (code) => { if (code) setOverviewLang(code); setOverviewOpen(true); };
  useEffect(() => { if (overviewOpen) narrator.pause(); }, [overviewOpen, narrator]);
  useEffect(() => { loadVoices().then((v) => { deviceVoices.current = v; voiceRef.current = pickVoice(v, prefs.audio.voice, prefs.audio.tone); }); }, [prefs.audio.voice, prefs.audio.tone]);
  // language of what's on the page, from its script — drives the voice, the font and the text's lang attribute
  const chapterLang = useMemo(() => detectLanguage(chapter?.content), [chapter]);
  useEffect(() => () => narrator.destroy(), [narrator]);
  const autoNext = useRef(false);

  // The script always covers the whole chapter (so the transcript can show it all and any word can be tapped);
  // `segMeta[i]` says where segment i sits: paragraph index + character offset inside that paragraph's text.
  const segMeta = useRef([]);
  const buildScript = useCallback((ch, cast = [], gender = {}) => {
    const paras = splitParagraphs(ch.content);
    const visible = paras.map((para) => (para.length < 70 && /^#{1,3}\s/.test(para) ? para.replace(/^#+\s*/, '') : para)); // headings render without their marker
    const speakers = findSpeakers(visible); // characters of a play: a voice each, and their labels are never read out
    // casting: a man's part goes to the man's voice, a woman's to the woman's (judged from pronouns in the text);
    // anyone unclear takes the less-used voice. Characters sharing a voice are kept apart by a pitch offset.
    const used = new Map(cast.map((c) => [c.voice, 0]));
    const assigned = new Map();
    const castFor = (name) => {
      if (!name || !cast.length || !speakers.has(name)) return {};
      if (!assigned.has(name)) {
        const wanted = cast.filter((c) => c.gender === gender[name]);
        const pool = wanted.length ? wanted : cast;
        const pick = pool.reduce((best, c) => (used.get(c.voice) < used.get(best.voice) ? c : best), pool[0]);
        assigned.set(name, { voice: pick.voice, shift: CAST_SHIFTS[used.get(pick.voice) % CAST_SHIFTS.length] });
        used.set(pick.voice, used.get(pick.voice) + 1);
      }
      return assigned.get(name);
    };
    const ctx = { speakers, speaker: null, open: false };
    const segments = [];
    const meta = [];

    visible.forEach((p, pi) => {
      // directions and labels become silent lines (shown, never spoken); the feeling a direction asks for goes to the voice
      splitParagraph(p, ctx).forEach((span) => {
        const body = p.slice(span.start, span.end);
        const silent = span.kind === 'silent';
        const sentences = silent ? [{ 0: body, index: 0 }] : [...body.matchAll(SENTENCE_RE)];
        sentences.forEach((m, si) => {
          const text = m[0].trim();
          if (!text) return;
          const base = span.start + m.index + (m[0].length - m[0].trimStart().length);
          chunkAtSpaces(text).forEach(([i, piece]) => {
            const part = piece.trimEnd();
            if (!part) return;
            if (silent) {
              segments.push({ text: part, silent: true, pause_ms: 120, speaker: span.speaker });
            } else {
              segments.push({
                text: part, pause_ms: si === sentences.length - 1 ? 450 : 150, speaker: span.speaker,
                emotion: span.emotion, ...castFor(span.speaker),
              });
            }
            meta.push({ p: pi, start: base + i, silent });
          });
        });
      });
    });
    segMeta.current = meta;
    segParagraphs.current = meta.map((m) => m.p);
    return [{ title: ch.title, segments }];
  }, []);

  // Light up the word being spoken. It stays lit when paused, marking where playback will resume.
  useEffect(() => narrator.on((s) => {
    const m = segMeta.current[s.segment];
    if (m?.silent) clearSpokenWord();
    else if (m && (s.playing || s.charIndex)) showSpokenWord(articleRef.current, m.p, m.start + (s.charIndex || 0));
  }), [narrator]);
  useEffect(() => clearSpokenWord, []);

  useEffect(() => narrator.on((s) => {
    setListen({ playing: s.playing, paragraph: s.playing || s.segment ? segParagraphs.current[s.segment] ?? null : null });
    if (s.neuralFailed) notify('Natural voices are unavailable right now — using your device voice.', 'info');
    if (s.finished) {
      clearSpokenWord();
      setListen({ playing: false, paragraph: null });
      if (prefs.audio.autoAdvance && doc && chapterIndex + 1 < doc.chapter_count) {
        autoNext.current = true;
        goChapter(chapterIndex + 1);
      }
    }
  }), [narrator, prefs.audio.autoAdvance, doc, chapterIndex, goChapter, notify]);

  const castCache = useRef({}); // chapter → {name: 'male' | 'female' | null}, judged from the whole document

  /** Read the chapter aloud from a paragraph — or, with `fromChar`, from a word inside it. */
  const startListening = useCallback(async (fromParagraph, fromChar = 0) => {
    const neural = nv.neuralFor(chapterLang); // a natural voice for this language (null → the device's own)
    if (!speechSupported && !neural) { notify('Read-aloud isn’t supported in this browser', 'warning'); return; }
    if (!chapter) return;
    let from = fromParagraph;
    if (from == null) {
      const main = getScroller();
      const ps = [...(articleRef.current?.querySelectorAll('[data-p]') || [])];
      const visible = ps.find((p) => p.getBoundingClientRect().bottom > (main?.getBoundingClientRect().top || 0) + 120);
      from = visible ? Number(visible.dataset.p) : 0;
    }
    const langVoices = nv.languages.find((l) => l.code === chapterLang)?.voices || [];
    const cast = neural && langVoices.length > 1 ? langVoices.map((v) => ({ voice: v.id, gender: v.gender.toLowerCase() })) : [];
    // a play: judge who is a man and who a woman from the whole book (the cast is cached, so only the first read waits)
    let gender = {};
    if (cast.length) {
      narrator.prime(); // keep this tap's permission to play audio while the cast is fetched
      const names = [...findSpeakers(splitParagraphs(chapter.content))];
      if (names.length) {
        const key = `${docId}:${chapterIndex}`;
        if (!castCache.current[key]) castCache.current[key] = await api.tts.cast(docId, names).then((r) => r.hints).catch(() => ({}));
        gender = castCache.current[key];
      }
    }
    const script = buildScript(chapter, cast, gender);
    const meta = segMeta.current;
    let segment = meta.findIndex((m, i) => m.p === from && m.start + script[0].segments[i].text.length > fromChar);
    if (segment < 0) segment = meta.findIndex((m) => m.p >= from);
    const m = meta[Math.max(0, segment)];
    const offset = m && m.p === from ? Math.max(0, fromChar - m.start) : 0;
    // device fallback: a voice for the page's language when the device has one, never the English voice for Tamil text
    const voice = chapterLang === 'en' ? voiceRef.current : pickVoiceForLang(deviceVoices.current, chapterLang);
    narrator.load(script, { rate: prefs.audio.rate, voice, lang: speechTag(chapterLang), segment: Math.max(0, segment), offset, neural });
    narrator.play();
  }, [chapter, chapterIndex, docId, narrator, buildScript, prefs.audio.rate, getScroller, notify, nv, chapterLang]);

  // ─── Tap a word: read from it (jump straight there while playing) ──────────
  const [wordMenu, setWordMenu] = useState(null); // {word, p, start, pos}
  const onWordTap = useCallback((hit) => {
    if (narrator.playing) { setWordMenu(null); startListening(hit.p, hit.start); return; }
    const host = surfaceRef.current?.getBoundingClientRect();
    if (!host) return;
    const below = hit.rect.top - host.top < 120;
    setWordMenu({
      ...hit,
      pos: {
        x: Math.min(Math.max(hit.rect.left + hit.rect.width / 2 - host.left, 130), host.width - 130),
        y: (below ? hit.rect.bottom + 12 : hit.rect.top - 12) - host.top,
        below,
      },
    });
  }, [narrator, startListening]);

  const onArticleClick = useCallback((e) => {
    if (e.target.closest('mark[data-hl], a, button, .selection-toolbar, .popover, .modal') || window.getSelection()?.toString()) return;
    const hit = wordAtPoint(e.clientX, e.clientY, articleRef.current);
    if (hit) onWordTap(hit); else setWordMenu(null);
  }, [onWordTap]);

  useEffect(() => {
    if (!wordMenu) return undefined;
    const out = (e) => { if (!e.target.closest('.word-menu')) setWordMenu(null); };
    const esc = (e) => e.key === 'Escape' && setWordMenu(null);
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); };
  }, [wordMenu]);

  useEffect(() => { setWordMenu(null); clearSpokenWord(); }, [chapterIndex]);

  const onWordAction = (action) => {
    const w = wordMenu;
    setWordMenu(null);
    if (!w) return;
    if (action === 'listen') startListening(w.p, w.start);
    else if (action === 'define') openAI({ documentId: docId, chapterIndex, selection: w.word, tool: 'define', tab: 'tools', nonce: Date.now() });
    else if (action === 'explain') openAI({ documentId: docId, chapterIndex, selection: w.word, tool: 'explain', tab: 'tools', nonce: Date.now() });
    else if (action === 'ask') openAI({ documentId: docId, chapterIndex, selection: w.word, tab: 'chat', nonce: Date.now() });
  };

  useEffect(() => {
    if (autoNext.current && chapter) { autoNext.current = false; startListening(0); }
  }, [chapter]); // eslint-disable-line

  useEffect(() => {
    if (!listen.playing || listen.paragraph == null || pagedRef.current) return; // the paged reader turns pages itself
    const el = articleRef.current?.querySelector(`[data-p="${listen.paragraph}"]`);
    el?.scrollIntoView({ block: 'center', behavior: prefs.accessibility.reducedMotion ? 'auto' : 'smooth' });
  }, [listen.paragraph, listen.playing, prefs.accessibility.reducedMotion]);

  // ─── Selection, highlights, notes ──────────────────────────────────────────
  const surfaceRef = useRef(null);
  const [selection, setSelection] = useState(null); // {text, pos}
  const [hlPop, setHlPop] = useState(null);
  const [noteDraft, setNoteDraft] = useState(null);

  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim();
    if (!sel || !text || text.length < 2 || !articleRef.current?.contains(sel.anchorNode)) { setSelection(null); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = surfaceRef.current.getBoundingClientRect();
    const below = rect.top < 120;
    setSelection({
      text: text.slice(0, 4000),
      pos: { x: Math.min(Math.max(rect.left + rect.width / 2 - host.left, 150), host.width - 150), y: (below ? rect.bottom + 12 : rect.top - 12) - host.top, below },
    });
  }, []);

  useEffect(() => {
    const onUp = (e) => {
      // clicks inside the toolbar/popovers must not re-read (and reset) the selection UI
      if (e?.target?.closest?.('.selection-toolbar, .popover, .modal')) return;
      setTimeout(readSelection, 10);
    };
    const onKeyUp = (e) => e.shiftKey && onUp();
    const onChange = () => { if (!window.getSelection()?.toString()) setSelection(null); };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('selectionchange', onChange);
    };
  }, [readSelection]);

  const addHighlight = async (text, category) => {
    const temp = { id: `tmp-${Date.now()}`, chapter_index: chapterIndex, text, category, note: null };
    setHighlights((h) => [...h, temp]);
    try {
      const saved = await api.documents.addHighlight(docId, { chapter_index: chapterIndex, text, category });
      setHighlights((h) => h.map((x) => (x.id === temp.id ? saved : x)));
      notify(`Highlighted as ${category}`, 'success', { action: { label: 'Undo', onClick: () => removeHighlight(saved) } });
    } catch (err) {
      setHighlights((h) => h.filter((x) => x.id !== temp.id));
      notify(err.message, 'error');
    }
  };
  const updateHighlight = async (h, patch) => {
    setHighlights((list) => list.map((x) => (x.id === h.id ? { ...x, ...patch } : x)));
    setHlPop((p) => (p ? { ...p, highlight: { ...p.highlight, ...patch } } : p));
    try { await api.documents.updateHighlight(h.id, patch); } catch (err) { notify(err.message, 'error'); }
  };
  async function removeHighlight(h) {
    setHighlights((list) => list.filter((x) => x.id !== h.id));
    setHlPop(null);
    try { await api.documents.removeHighlight(h.id); } catch (err) { notify(err.message, 'error'); }
  }

  const onSelectionAction = (action, arg) => {
    const text = selection?.text;
    if (!text) return;
    const clear = () => { window.getSelection()?.removeAllRanges(); setSelection(null); };
    switch (action) {
      case 'highlight': addHighlight(text, arg); break;
      case 'note': setNoteDraft({ quote: text, title: text.split(/\s+/).slice(0, 8).join(' '), content: '', category: 'Note' }); break;
      case 'explain': openAI({ documentId: docId, chapterIndex, selection: text, tool: 'explain', tab: 'tools', nonce: Date.now() }); break;
      case 'ask': openAI({ documentId: docId, chapterIndex, selection: text, tab: 'chat', nonce: Date.now() }); break;
      case 'define': openAI({ documentId: docId, chapterIndex, selection: text, tool: 'define', tab: 'tools', nonce: Date.now() }); break;
      case 'diagram': openAI({ documentId: docId, chapterIndex, selection: text, tool: 'diagram', tab: 'tools', nonce: Date.now() }); break;
      case 'listen': speak(stripDirections(text), { rate: prefs.audio.rate, voice: voiceRef.current }); break;
      case 'translate': window.open(`https://translate.google.com/?sl=auto&tl=${(navigator.language || 'en').slice(0, 2)}&text=${encodeURIComponent(text)}&op=translate`, '_blank', 'noopener'); break;
      case 'copy': navigator.clipboard?.writeText(text).then(() => notify('Copied')); break;
      default:
    }
    clear();
  };

  const onHighlightClick = useCallback((h, el) => {
    const rect = el.getBoundingClientRect();
    const host = surfaceRef.current.getBoundingClientRect();
    setHlPop({ highlight: h, pos: { x: Math.min(Math.max(rect.left - host.left, 10), host.width - 290), y: rect.bottom - host.top + 8 } });
  }, []);

  const saveNote = async (e) => {
    e.preventDefault();
    try {
      await api.notes.create({ document_id: docId, chapter_index: chapterIndex, title: noteDraft.title || 'Note', content: noteDraft.content, quote: noteDraft.quote, category: noteDraft.category, note_type: 'note' });
      notify('Note saved to your notebook', 'success', { action: { label: 'Open', onClick: () => navigate('/notes') } });
      setNoteDraft(null);
    } catch (err) { notify(err.message, 'error'); }
  };

  // ─── Bookmarks ─────────────────────────────────────────────────────────────
  const currentBookmark = bookmarks.find((b) => b.chapter_index === chapterIndex && Math.abs(b.scroll_ratio - ratioRef.current) < 0.04);
  // The paged reader passes the bookmark under the current page and a label for a new one.
  const toggleBookmark = async ({ existing = currentBookmark, label: given } = {}) => {
    if (existing) {
      setBookmarks((b) => b.filter((x) => x.id !== existing.id));
      api.documents.removeBookmark(existing.id).catch((err) => notify(err.message, 'error'));
      notify('Bookmark removed');
      return;
    }
    const main = getScroller();
    const p = [...(articleRef.current?.querySelectorAll('[data-p]') || [])].find((n) => n.getBoundingClientRect().bottom > (main?.getBoundingClientRect().top || 0) + 120);
    const label = given || (p?.textContent || chapter?.title || 'Bookmark').split(/\s+/).slice(0, 9).join(' ');
    try {
      const b = await api.documents.addBookmark(docId, { chapter_index: chapterIndex, scroll_ratio: Number(ratioRef.current.toFixed(4)), label });
      setBookmarks((list) => [...list, b]);
      notify('Bookmark saved');
    } catch (err) { notify(err.message, 'error'); }
  };

  // ─── UI state & shortcuts ──────────────────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(!!params.get('q'));
  const [tocOpen, setTocOpen] = useState(false);
  const [ruler, setRuler] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setSearchOpen(true); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || window.getSelection()?.toString()) return;
      if (e.key === 'ArrowRight' && e.shiftKey) goChapter(chapterIndex + 1);
      else if (e.key === 'ArrowLeft' && e.shiftKey) goChapter(chapterIndex - 1);
      else if (e.key === 'n') goChapter(chapterIndex + 1);
      else if (e.key === 'p') goChapter(chapterIndex - 1);
      else if (e.key === 'b') toggleBookmark();
      else if (e.key === 'a') openAI({ documentId: docId, chapterIndex, nonce: Date.now() });
      else if (e.key === 'l') (listen.playing ? narrator.pause() : startListening());
      else if (e.key === 'm') setMode(MODES[(MODES.findIndex((x) => x.id === mode) + 1) % MODES.length].id);
      else if (e.key === 't') setSettingsOpen((s) => !s);
      else if (e.key === 'Escape') { setSettingsOpen(false); setHlPop(null); setSelection(null); setTocOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const saveOffline = async () => {
    try {
      await offline.save(await api.documents.package(docId));
      await api.documents.update(docId, { offline: true });
      notify('Saved for offline reading');
      refreshData();
    } catch (err) { notify(err.message, 'error'); }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="page-shell">
        <ErrorState error={loadError} onRetry={() => window.location.reload()} />
        <button className="text-button" onClick={() => navigate('/library')}><ArrowLeft size={14} /> Back to library</button>
      </div>
    );
  }
  if (!doc) return <PageLoader label="Opening document…" />;

  const r = prefs.reading;
  const surfaceStyle = {
    '--read-font': READING_FONTS[r.font]?.css,
    '--read-size': `${r.fontSize}px`,
    '--read-lh': r.lineHeight,
    '--read-width': READING_WIDTHS[r.width],
    '--read-gap': `${r.paragraphSpacing}em`,
    '--read-align': r.align,
    '--vibe-contrast': prefs.vibe.contrast / 100,
  };
  const zenPreset = ZEN_PRESETS.find((p) => p.id === prefs.zen.preset) || ZEN_PRESETS[0];
  const vibePreset = VIBE_PRESETS.find((p) => p.id === prefs.vibe.preset) || VIBE_PRESETS[0];
  const chapterHighlights = highlights.filter((h) => h.chapter_index === chapterIndex);
  const meta = doc.chapters?.[chapterIndex];
  const isLast = chapterIndex === doc.chapter_count - 1;
  const titleParts = (chapter?.title || meta?.title || '').split(/ · |: /);

  const noteModal = noteDraft && (
      <Modal open onClose={() => setNoteDraft(null)} eyebrow="NEW NOTE" title="Add a note" icon={StickyNote}>
        <form className="stack" onSubmit={saveNote}>
          <blockquote className="note-quote">“{noteDraft.quote}”</blockquote>
          <Field label="Title"><input className="input" value={noteDraft.title} onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })} /></Field>
          <Field label="Your note"><textarea className="input" rows={4} autoFocus value={noteDraft.content} onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })} placeholder="What does this make you think?" /></Field>
          <Field label="Category">
            <select className="input" value={noteDraft.category} onChange={(e) => setNoteDraft({ ...noteDraft, category: e.target.value })}>
              {['Note', 'Important', 'Question', 'Definition', 'Exam', 'Research'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => setNoteDraft(null)}>Cancel</button>
            <button className="primary-button">Save note</button>
          </div>
        </form>
      </Modal>
  );

  if (paged) {
    return (
      <MobileReader
        doc={doc} chapter={chapter} chapterIndex={chapterIndex} chapterLoading={chapterLoading}
        highlights={chapterHighlights} allHighlights={highlights} bookmarks={bookmarks}
        searchOpen={searchOpen} setSearchOpen={setSearchOpen} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        onToggleBookmark={toggleBookmark}
        onDeleteBookmark={async (b) => {
          if (await confirm({ title: 'Delete bookmark?', confirmLabel: 'Delete', danger: true })) {
            setBookmarks((l) => l.filter((x) => x.id !== b.id));
            api.documents.removeBookmark(b.id).catch(() => {});
          }
        }}
        onHighlightClick={onHighlightClick} goChapter={goChapter} setMode={setMode}
        surfaceRef={surfaceRef} articleRef={articleRef} ratioRef={ratioRef} pendingScroll={pendingScroll} pendingFind={pendingFind}
        saveProgress={saveProgress} lastActivity={lastActivity}
        narrator={narrator} listen={listen} startListening={startListening} segMeta={segMeta} onWordTap={onWordTap}
        lang={chapterLang} onOverview={() => openOverview()}
        offlineMode={offlineMode} saveOffline={saveOffline}
        downloadOriginal={() => api.documents.downloadFile(docId).catch((e) => notify(e.message, 'error'))}
        navigate={navigate} openAI={openAI} notify={notify}
      >
        {overviewOpen && <OverviewSheet doc={doc} chapterIndex={chapterIndex} chapterTitle={chapter?.title} sourceLang={chapterLang} initialLang={overviewLang} onClose={() => setOverviewOpen(false)} />}
        <SelectionToolbar pos={selection?.pos} onAction={onSelectionAction} />
        <WordMenu menu={wordMenu} onAction={onWordAction} />
        {hlPop && (
          <HighlightPopover highlight={hlPop.highlight} pos={hlPop.pos} onClose={() => setHlPop(null)}
            onUpdate={(patch) => updateHighlight(hlPop.highlight, patch)} onDelete={() => removeHighlight(hlPop.highlight)}
            onExplain={(t) => { setHlPop(null); openAI({ documentId: docId, chapterIndex, selection: t, tool: 'explain', tab: 'tools', nonce: Date.now() }); }} />
        )}
        {noteModal}
      </MobileReader>
    );
  }

  return (
    <div className={`reader-page mode-${mode.toLowerCase()} paper-${r.paper} ${r.focusLine ? 'focus-line' : ''}`}
      onPointerMove={r.ruler ? (e) => setRuler(e.clientY) : undefined}>
      {mode === 'Zen' && <ZenBackdrop palette={zenPreset.palette} />}
      {mode === 'Vibe' && <VibeVisualizer playing={music.playing} getLevels={getLevels} hue={vibePreset.hue} intensity={prefs.vibe.intensity} />}
      {r.ruler && ruler != null && <div className="reading-ruler" style={{ top: ruler - 22 }} aria-hidden="true" />}

      <header className="reader-top">
        <button className="back-button" onClick={() => navigate('/library')} aria-label="Back to library"><ArrowLeft size={17} /></button>
        <div className="reader-title">
          <span>{doc.type} · {doc.author}</span>
          <strong>{doc.title}</strong>
        </div>
        {offlineMode && <span className="offline-chip"><WifiOff size={12} /> Offline copy</span>}
        <div className="reader-actions">
          <button className="toc-toggle" onClick={() => setTocOpen((o) => !o)} aria-label="Contents" aria-expanded={tocOpen}><List size={17} /></button>
          <button onClick={() => setSearchOpen((s) => !s)} aria-label="Search in document (Ctrl+F)" className={searchOpen ? 'active' : ''}><Search size={17} /></button>
          <button onClick={toggleBookmark} aria-label={currentBookmark ? 'Remove bookmark (B)' : 'Bookmark this position (B)'} className={currentBookmark ? 'active' : ''}>
            {currentBookmark ? <BookmarkCheck size={17} /> : <BookmarkIcon size={17} />}
          </button>
          <div className="popover-anchor">
            <button onClick={() => setSettingsOpen((s) => !s)} aria-label="Display settings (T)" aria-expanded={settingsOpen} className={settingsOpen ? 'active' : ''}><Type size={17} /></button>
            {settingsOpen && <ReaderSettings onClose={() => setSettingsOpen(false)} />}
          </div>
          <Menu trigger={<MoreHorizontal size={17} />} label="More reader options" items={[
            { label: 'Open AI companion', icon: Sparkles, onClick: () => openAI({ documentId: docId, chapterIndex, nonce: Date.now() }) },
            { label: 'Generate audiobook', icon: Headphones, onClick: () => navigate(`/audio?tab=generate&doc=${docId}`) },
            { label: 'Save for offline reading', icon: CloudDownload, onClick: saveOffline, disabled: offlineMode },
            doc.has_file && { label: 'Download original file', icon: Download, onClick: () => api.documents.downloadFile(docId).catch((e) => notify(e.message, 'error')) },
            { label: 'Open notebook', icon: StickyNote, onClick: () => navigate(`/notes?doc=${docId}`) },
          ]} />
        </div>
      </header>

      <div className="mode-switcher" role="tablist" aria-label="Reading mode">
        {MODES.map(({ id, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)} title={`${id} mode (M)`}>
            <Icon size={14} /> {id}
          </button>
        ))}
      </div>

      {searchOpen && (
        <DocSearch documentId={docId} initialQuery={searchQuery} onQuery={setSearchQuery} onClose={() => { setSearchOpen(false); setSearchQuery(''); }}
          onJump={(m) => goChapter(m.chapter_index, { find: `${m.match}${m.after}`.slice(0, 40).replace(/…$/, '') })} />
      )}

      <div className="reader-layout">
        <aside className={`chapter-nav ${tocOpen ? 'open' : ''}`} aria-label="Table of contents">
          <div className="chapter-nav-head">
            <div><div className="eyebrow">CONTENTS</div><h3>{doc.chapter_count} sections</h3></div>
            <button className="icon-ghost sm toc-close" onClick={() => setTocOpen(false)} aria-label="Close contents"><X size={15} /></button>
          </div>
          <nav>
            {doc.chapters.map((ch) => {
              const n = highlights.filter((h) => h.chapter_index === ch.index).length;
              return (
                <button key={ch.index} className={chapterIndex === ch.index ? 'selected' : ''} onClick={() => goChapter(ch.index)} aria-current={chapterIndex === ch.index ? 'true' : undefined}>
                  <span className="ch-num">{String(ch.index + 1).padStart(2, '0')}</span>
                  <span className="ch-title">{ch.title}</span>
                  <small className="ch-dur">{ch.minutes}m{n ? ` · ${n}✦` : ''}</small>
                </button>
              );
            })}
          </nav>
          <div className="reader-stat">
            <Clock3 size={14} />
            <div><span>Today</span><b>{formatMinutes((stats.data?.today_minutes || 0) + Math.floor(todaySeconds / 60))}</b></div>
          </div>
        </aside>

        <article className="reading-surface" ref={surfaceRef} style={surfaceStyle} aria-busy={chapterLoading}>
          {overviewOpen && <OverviewSheet doc={doc} chapterIndex={chapterIndex} chapterTitle={chapter?.title} sourceLang={chapterLang} initialLang={overviewLang} onClose={() => setOverviewOpen(false)} />}
          <SelectionToolbar pos={selection?.pos} onAction={onSelectionAction} />
          <WordMenu menu={wordMenu} onAction={onWordAction} />
          {hlPop && (
            <HighlightPopover highlight={hlPop.highlight} pos={hlPop.pos} onClose={() => setHlPop(null)}
              onUpdate={(patch) => updateHighlight(hlPop.highlight, patch)} onDelete={() => removeHighlight(hlPop.highlight)}
              onExplain={(t) => { setHlPop(null); openAI({ documentId: docId, chapterIndex, selection: t, tool: 'explain', tab: 'tools', nonce: Date.now() }); }} />
          )}
          <div className="reading-inner" ref={articleRef} onClick={onArticleClick} lang={chapterLang}>
            <div className="chapter-label">SECTION {String(chapterIndex + 1).padStart(2, '0')} <span>•</span> {doc.chapter_count} TOTAL</div>
            <h2>{titleParts[0]}{titleParts[1] && <><br /><em>{titleParts.slice(1).join(' · ')}</em></>}</h2>
            <div className="reading-meta">
              <span>{doc.author}</span><span>·</span><span>{meta?.minutes || 1} min read</span>
              <button className="meta-settings" onClick={() => setSettingsOpen(true)}><Type size={13} /> Aa</button>
            </div>
            {chapterLoading && !chapter ? <PageLoader label="Loading chapter…" /> : chapter && (
              <ChapterText content={chapter.content} highlights={chapterHighlights} query={searchOpen ? searchQuery : ''}
                activeParagraph={listen.playing ? listen.paragraph : null} onHighlightClick={onHighlightClick}
                dropcap={chapterLang === 'en'} />
            )}
            <div className="chapter-end">
              {!isLast ? (
                <button className="next-chapter" onClick={() => goChapter(chapterIndex + 1)}>
                  <small>NEXT</small><strong>{doc.chapters[chapterIndex + 1]?.title}</strong><ChevronRight size={18} />
                </button>
              ) : <p className="finished-note">🎉 You’ve reached the end of “{doc.title}”.</p>}
              <div className="chapter-end-actions">
                <button className="chip" onClick={() => openAI({ documentId: docId, chapterIndex, tool: 'summarize', nonce: Date.now() })}><Sparkles size={12} /> Summarize this section</button>
                <button className="chip" onClick={() => openAI({ documentId: docId, chapterIndex, tool: 'quiz', nonce: Date.now() })}><CircleHelp size={12} /> Quiz me</button>
                <button className="chip" onClick={() => openOverview()}><AudioLines size={12} /> Audio overview</button>
              </div>
            </div>
          </div>
          <footer className="reader-footer">
            <button className="icon-ghost sm" onClick={() => goChapter(chapterIndex - 1)} disabled={chapterIndex === 0} aria-label="Previous chapter"><ChevronLeft size={16} /></button>
            <span>{chapterIndex + 1}/{doc.chapter_count}</span>
            <ProgressBar value={docProgress} className="reader-progress" label="Document progress" />
            <span>{Math.round(docProgress)}%</span>
            <button className="icon-ghost sm" onClick={() => goChapter(chapterIndex + 1)} disabled={isLast} aria-label="Next chapter"><ChevronRight size={16} /></button>
            <button className="ai-reader-button" onClick={() => openAI({ documentId: docId, chapterIndex, nonce: Date.now() })}><Sparkles size={14} /> Ask AI</button>
            <OverviewLauncher languages={nv.languages} value={overviewLang} onOpen={openOverview} onPick={openOverview} />
            <button className={`audio-mini ${listen.playing ? 'playing' : ''}`} onClick={() => (listen.playing ? narrator.pause() : startListening())} aria-label={listen.playing ? 'Pause read-aloud' : 'Read aloud from here'}>
              {listen.playing ? <Pause size={13} /> : <Play size={13} fill="currentColor" />} {listen.playing ? 'Pause' : 'Listen'}
            </button>
          </footer>
        </article>

        {mode === 'Reader' && (
          <aside className="context-rail">
            <div className="rail-card ai-card">
              <Sparkles size={16} />
              <strong>ReadVibe insight</strong>
              <p>Get the key ideas of “{meta?.title}”, or turn it into a mind map.</p>
              <div className="rail-buttons">
                <button onClick={() => openAI({ documentId: docId, chapterIndex, tool: 'summarize', nonce: Date.now() })}>Summarize →</button>
                <button onClick={() => openAI({ documentId: docId, chapterIndex, tool: 'mindmap', nonce: Date.now() })}>Mind map →</button>
              </div>
            </div>
            <div className="rail-card">
              <div className="rail-head"><span>HIGHLIGHTS · {highlights.length}</span></div>
              {highlights.length === 0 && <p className="rail-empty">Select any text to highlight it. Your highlights appear here.</p>}
              {highlights.slice(-6).reverse().map((h) => (
                <button key={h.id} className={`highlight-line hl-${categoryColor(h.category)}`} onClick={() => goChapter(h.chapter_index, { find: h.text.slice(0, 40) })}>
                  <i />
                  <span><p>“{h.text.length > 90 ? `${h.text.slice(0, 90)}…` : h.text}”</p><small>{h.category} · section {h.chapter_index + 1}</small></span>
                </button>
              ))}
              {highlights.length > 0 && <button className="text-button small" onClick={() => navigate(`/notes?doc=${docId}`)}>Open notebook →</button>}
            </div>
            {bookmarks.length > 0 && (
              <div className="rail-card">
                <div className="rail-head"><span>BOOKMARKS · {bookmarks.length}</span></div>
                {bookmarks.map((b) => (
                  <div key={b.id} className="bookmark-line">
                    <button onClick={() => goChapter(b.chapter_index, { ratio: b.scroll_ratio })}><BookmarkIcon size={12} /> <span>{b.label}</span></button>
                    <button className="icon-ghost sm" aria-label="Delete bookmark" onClick={async () => {
                      if (await confirm({ title: 'Delete bookmark?', confirmLabel: 'Delete', danger: true })) {
                        setBookmarks((l) => l.filter((x) => x.id !== b.id));
                        api.documents.removeBookmark(b.id).catch(() => {});
                      }
                    }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
        {mode === 'Zen' && <aside className="zen-rail"><ZenPanel engine={ambient} timer={timer} ambientOn={ambientOn} setAmbientOn={setAmbientOn} /></aside>}
        {mode === 'Vibe' && <aside className="vibe-rail"><VibePanel player={player} music={music} /></aside>}
      </div>

      {mode === 'Zen' && timer.running && (
        <div className="focus-pill" role="status"><Moon size={13} /> {timer.phase === 'break' ? 'Break' : 'Focus'} · {Math.floor(timer.left / 60)}:{String(timer.left % 60).padStart(2, '0')}</div>
      )}

      {noteModal}
      {chapterLoading && chapter && <div className="chapter-loading"><Loader2 size={14} className="spin" /> Loading…</div>}
    </div>
  );
}
