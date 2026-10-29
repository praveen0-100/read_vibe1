// ─── Audio Overview ───────────────────────────────────────────────────────────────────────────────────────
// Pick a language (Tamil · Telugu · Malayalam · Kannada first), a format (two-host conversation or one-storyteller
// narrative) and a scope; the server writes the script natively in that language and the narrator performs it with
// natural voices while the transcript follows word by word.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AudioLines, BookOpen, FastForward, Gauge, Pause, Play, Quote, Rewind, Users, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useNaturalVoice } from '../../hooks/useNaturalVoice';
import { useScriptTranslation } from '../../hooks/useScriptTranslation';
import { formatClock } from '../../lib/format';
import { chunkAtSpaces, SENTENCE_RE, speechTag } from '../../lib/languages';
import { loadVoices, Narrator, pickVoiceForLang } from '../../lib/speech';
import { Menu } from '../ui';
import ReadLanguage from '../reader/ReadLanguage';
import LyricsView from './LyricsView';
import ReaderView from './ReaderView';

const SPEEDS = [0.75, 1, 1.25, 1.5];
const FORMATS = [
  { id: 'conversation', icon: Users, title: 'Conversation', text: 'Two hosts talk it through, like a podcast.' },
  { id: 'narrative', icon: BookOpen, title: 'Narrative', text: 'One storyteller carries you through it as a story.' },
];

/** Turns → speakable segments, each carrying its speaker's voice; `first` marks where a new speaker's turn begins. */
export function buildOverviewScript(result) {
  const segments = [];
  result.turns.forEach((turn) => {
    const pieces = [];
    [...turn.text.matchAll(SENTENCE_RE)].map((m) => m[0].trim()).filter(Boolean)
      .forEach((s) => chunkAtSpaces(s).forEach(([, p]) => p.trim() && pieces.push(p.trim())));
    pieces.forEach((text, j) => segments.push({
      text, voice: turn.voice, speaker: turn.speaker, emotion: turn.emotion, first: j === 0, position: j === 0 ? 'start' : j === pieces.length - 1 ? 'end' : 'mid', pause_ms: j === pieces.length - 1 ? 520 : 140,
    }));
  });
  return [{ title: result.title, segments }];
}

function LanguageChip({ lang, on, onPick }) {
  return (
    <button type="button" className={`ov-lang ${on ? 'on' : ''}`} disabled={!lang.has_voice} aria-pressed={on} onClick={() => onPick(lang.code)}>
      <span className="native" lang={lang.code}>{lang.native}</span>
      <small>{lang.name}{!lang.has_voice ? ' · text only' : ''}</small>
    </button>
  );
}

export default function OverviewSheet({ doc, chapterIndex, chapterTitle, sourceLang = 'en', initialLang = null, onClose }) {
  const { prefs, setPrefs, notify } = useApp();
  const nv = useNaturalVoice();
  const narrator = useMemo(() => new Narrator(), []);

  const [phase, setPhase] = useState('setup'); // setup | working | ready
  // an explicit pick from the dropdown wins; otherwise the document's own language, then the last one used
  const [lang, setLang] = useState(() => initialLang || (sourceLang !== 'en' ? sourceLang : prefs.audio.overviewLang) || 'ta');
  const [format, setFormat] = useState('conversation');
  const [scope, setScope] = useState('chapter');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [now, setNow] = useState({ playing: false, speaker: null });
  const [rate, setRate] = useState(prefs.audio.rate || 1);
  const [, tick] = useState(0);
  const [view, setView] = useState('transcript'); // transcript | reader
  const [tlang, setTlang] = useState('orig'); // transcript + voices in another language than the one generated
  const loadedLang = useRef(null);

  const baseScript = useMemo(() => (result ? buildOverviewScript(result) : null), [result]);
  const { script: viewScript, status: tr } = useScriptTranslation(baseScript, tlang, result?.language);
  const viewLang = result ? (tr.ready ? tlang : result.language) : lang;

  useEffect(() => () => narrator.destroy(), [narrator]);
  useEffect(() => { if (tr.error) notify(`Translation failed: ${tr.error}`, 'error'); }, [tr.error]); // eslint-disable-line
  useEffect(() => { if (tr.note) notify(tr.note, 'warning'); }, [tr.note]); // eslint-disable-line

  // A translation arrived (or was switched off): re-voice the script in that language, keeping the place and play state.
  useEffect(() => {
    if (!result || loadedLang.current === null || loadedLang.current === viewLang) return undefined;
    let live = true;
    (async () => {
      const code = viewLang;
      const translated = code !== result.language;
      // each host keeps their own slot (female / male) in the new language's voices
      const script = translated
        ? viewScript.map((c) => ({ ...c, segments: c.segments.map((s) => ({ ...s, voice: nv.voiceFor(code, s.speaker === 'host_b' ? 1 : 0) || s.voice })) }))
        : viewScript;
      const first = script[0]?.segments[0]?.voice;
      const neural = nv.on && first ? { synth: api.tts.synthesize, voice: first } : null;
      const device = neural ? null : pickVoiceForLang(await loadVoices(), code);
      if (!live) return;
      const wasPlaying = narrator.playing;
      narrator.load(script, { rate, neural, voice: device, lang: speechTag(code), chapter: narrator.chapter, segment: narrator.segment });
      if (wasPlaying) narrator.play();
      loadedLang.current = code;
      if (!neural && !device) setNote(`This device has no ${nv.languages.find((l) => l.code === code)?.name || code} voice. Turn on Natural voices in Settings to listen — the transcript is below.`);
    })();
    return () => { live = false; };
  }, [viewLang, viewScript]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => narrator.on((s) => setNow({ playing: s.playing, speaker: narrator.script[s.chapter]?.segments?.[s.segment]?.speaker ?? null })), [narrator]);
  useEffect(() => {
    if (!now.playing) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [now.playing]);

  const catalogue = nv.languages;
  const south = catalogue.filter((l) => l.region === 'south');
  const india = catalogue.filter((l) => l.region === 'india');
  const english = catalogue.filter((l) => l.region === 'world');
  const chosen = catalogue.find((l) => l.code === lang);
  const reduced = prefs.accessibility.reducedMotion;

  const create = async () => {
    narrator.prime(); // inside the tap: lets the browser play audio later, when the script arrives
    setError('');
    setPhase('working');
    try {
      const r = await api.ai.overview({ document_id: doc.id, chapter_index: scope === 'chapter' ? chapterIndex : null, language: lang, format });
      const neural = nv.on && r.turns[0]?.voice ? { synth: api.tts.synthesize, voice: r.turns[0].voice } : null;
      const device = neural ? null : pickVoiceForLang(await loadVoices(), lang);
      narrator.load(buildOverviewScript(r), { rate, neural, voice: device, lang: speechTag(lang) });
      const voiceNote = neural ? '' : device ? `Using your device’s ${r.language_name} voice. Turn on Natural voices in Settings for a more human sound.`
        : `This device has no ${r.language_name} voice. Turn on Natural voices in Settings to listen — the transcript is below.`;
      setNote([r.note, voiceNote].filter(Boolean).join(' ')); // r.note: e.g. "Free mode: the key points … translated automatically"
      setResult(r);
      setTlang('orig');
      loadedLang.current = r.language;
      setPrefs({ audio: { overviewLang: lang } });
      setPhase('ready');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setPhase('setup');
    }
  };

  const loaded = narrator.script.length > 0;
  const elapsed = narrator.elapsedSeconds;
  const total = narrator.totalSeconds;
  const hosts = result ? Object.entries(result.hosts) : [];
  const changeRate = (r) => { setRate(r); narrator.setRate(r); };

  return (
    <div className="ov-scrim" role="dialog" aria-modal="true" aria-label="Audio overview" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`ov-sheet phase-${phase}`}>
        <header className="ov-head">
          <span className="ov-badge"><AudioLines size={14} /> Audio Overview</span>
          <button className="ov-x" onClick={onClose} aria-label="Close" autoFocus><X size={18} /></button>
        </header>

        {phase === 'setup' && (
          <div className="ov-body">
            <h2>Listen in your language</h2>
            <p className="ov-sub">“{chapterTitle || doc.title}” — heard in your language with a natural voice and accent. Free for every language; no account or key needed.</p>

            {catalogue.length === 0 ? <p className="ov-sub">Loading languages…</p> : (
              <>
                <div className="ov-label">Southern languages</div>
                <div className="ov-langs south">{south.map((l) => <LanguageChip key={l.code} lang={l} on={lang === l.code} onPick={setLang} />)}</div>
                <div className="ov-label">Other Indian languages</div>
                <div className="ov-langs">{india.map((l) => <LanguageChip key={l.code} lang={l} on={lang === l.code} onPick={setLang} />)}</div>
                <div className="ov-langs">{english.map((l) => <LanguageChip key={l.code} lang={l} on={lang === l.code} onPick={setLang} />)}</div>
              </>
            )}

            <div className="ov-label">Format</div>
            <div className="ov-formats" role="radiogroup" aria-label="Format">
              {FORMATS.map(({ id, icon: Icon, title, text }) => (
                <button key={id} type="button" role="radio" aria-checked={format === id} className={`ov-format ${format === id ? 'on' : ''}`} onClick={() => setFormat(id)}>
                  <Icon size={20} /><strong>{title}</strong><small>{text}</small>
                </button>
              ))}
            </div>

            {doc.chapter_count > 1 && (
              <div className="ov-scope" role="radiogroup" aria-label="Scope">
                {[['chapter', 'This section'], ['book', 'Whole book']].map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={scope === id} className={scope === id ? 'on' : ''} onClick={() => setScope(id)}>{label}</button>
                ))}
              </div>
            )}

            {error && <div className="ov-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}

            <button className="ov-cta" onClick={create} disabled={!chosen?.has_voice}>
              <AudioLines size={18} /> Create overview in {chosen ? <span lang={chosen.code}>{chosen.native}</span> : 'this language'}
            </button>
          </div>
        )}

        {phase === 'working' && (
          <div className="ov-body ov-working" aria-live="polite">
            <div className={`ov-wave ${reduced ? 'still' : ''}`} aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 11) * 90}ms` }} />)}</div>
            <h2 lang={lang}>{chosen?.native}</h2>
            <p className="ov-sub">Writing your {format === 'conversation' ? 'conversation' : 'story'} in {chosen?.name}…</p>
            <p className="ov-fine">This usually takes under a minute. Next time it opens instantly.</p>
          </div>
        )}

        {phase === 'ready' && result && (
          <div className="ov-player">
            <div className="ov-hero">
              <span className="ov-pill"><span lang={result.language}>{result.native}</span> · {result.minutes} min · {result.format === 'conversation' ? 'Conversation' : 'Narrative'}</span>
              <h2 lang={result.language}>{result.title}</h2>
              <div className="ov-hosts">
                {hosts.map(([key, h]) => (
                  <div key={key} className={`ov-host ${key} ${now.speaker === key && now.playing ? 'speaking' : ''}`}>
                    <i aria-hidden="true">{h.name[0]}</i>
                    <span>{h.name}<small>{key === 'narrator' ? 'Storyteller' : key === 'host_a' ? 'Host' : 'Co-host'}</small></span>
                  </div>
                ))}
              </div>
            </div>

            <div className="tx-head">
              <div className="view-switch" role="tablist" aria-label="View">
                {[['transcript', 'Transcript', Quote], ['reader', 'Reader', BookOpen]].map(([id, label, Icon]) => (
                  <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}><Icon size={14} /> {label}</button>
                ))}
              </div>
              <ReadLanguage languages={nv.languages} value={tlang} onChange={setTlang} status={tr} sourceLang={result.language} align="right" />
            </div>
            {loaded && view === 'transcript' && <LyricsView narrator={narrator} lang={viewLang} speakers={result.hosts} reducedMotion={reduced} className="ov-lyrics" />}
            {loaded && view === 'reader' && <ReaderView narrator={narrator} lang={viewLang} speakers={result.hosts} reducedMotion={reduced} />}
            {note && <p className="ov-note" role="note">{note}</p>}

            <div className="ov-controls">
              <input type="range" className="mr-scrub" min={0} max={Math.max(1, Math.round(total))} value={Math.round(elapsed)} aria-label="Seek"
                style={{ '--fill': `${(elapsed / Math.max(1, total)) * 100}%` }} onChange={(e) => narrator.seekTime(+e.target.value)} />
              <div className="ov-times"><span>{formatClock(elapsed)}</span><span>-{formatClock(Math.max(0, total - elapsed))}</span></div>
              <div className="ov-buttons">
                <button onClick={() => { setPhase('setup'); narrator.pause(); }} className="ov-again">New</button>
                <button onClick={() => narrator.skip(-10)} aria-label="Back 10 seconds"><Rewind size={26} fill="currentColor" /></button>
                <button className="ov-play" onClick={() => narrator.toggle()} aria-label={now.playing ? 'Pause' : 'Play'}>
                  {now.playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
                </button>
                <button onClick={() => narrator.skip(30)} aria-label="Forward 30 seconds"><FastForward size={26} fill="currentColor" /></button>
                <Menu label="Speed" align="up" trigger={<span className="ls-pill"><Gauge size={15} /> {rate}×</span>}
                  items={SPEEDS.map((s) => ({ label: `${s}×`, checked: s === rate, onClick: () => changeRate(s) }))} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
