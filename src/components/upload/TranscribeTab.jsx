// ─── Upload → Transcribe audio: a recording becomes a transcript (and a library document) ──
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, BookOpen, Copy, FileAudio, Loader2, Mic, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { formatBytes } from '../../lib/format';
import { Field, ProgressBar, Segmented } from '../ui';

const FORMATS = ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'webm', 'opus'];
// Languages the Nemotron Transcribe model lists. (Malayalam and Kannada are not among them; Tamil, Telugu, Hindi, Marathi and Bengali are.)
const TRANSLATE_TO = ['English', 'Tamil', 'Telugu', 'Hindi', 'Marathi', 'Bengali', 'French', 'German', 'Spanish', 'Japanese', 'Chinese', 'Arabic'];
const STYLES = [
  { value: 'readable', label: 'Readable', title: 'Drops fillers and accidental repeats — good for notes and captions' },
  { value: 'verbatim', label: 'Verbatim', title: 'Every word as spoken, including fillers' },
  { value: 'speakers', label: 'Speakers', title: 'Labels who said what' },
];

export default function TranscribeTab({ onClose }) {
  const { trackJob, notify, refreshData } = useApp();
  const navigate = useNavigate();
  const status = useQuery(() => api.transcribe.status(), []);
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [opts, setOpts] = useState({ style: 'readable', translate_to: '', context: '', save: true });
  const [run, setRun] = useState({ phase: 'idle', progress: 0, stage: '', error: '', result: null });

  const cfg = status.data;
  const ext = file?.name.split('.').pop().toLowerCase();
  const limitMb = cfg?.max_mb || 60;
  const fileError = file && (!FORMATS.includes(ext) ? `.${ext} isn’t a supported audio type` : file.size > limitMb * 1024 * 1024 ? `Larger than the ${limitMb} MB limit` : '');
  const busy = run.phase === 'uploading' || run.phase === 'working';

  const start = async () => {
    setRun({ phase: 'uploading', progress: 0, stage: 'Uploading', error: '', result: null });
    try {
      const res = await api.transcribe.start(file, opts, (p) => setRun((r) => ({ ...r, progress: p * 0.3, stage: `Uploading ${p}%` })));
      setRun((r) => ({ ...r, phase: 'working', progress: 30, stage: 'Transcribing' }));
      const poll = setInterval(async () => {
        try {
          const job = await api.activity.job(res.job_id);
          if (job.status === 'processing' || job.status === 'queued') setRun((r) => ({ ...r, progress: Math.max(r.progress, 30 + job.progress * 0.7), stage: job.stage }));
          else clearInterval(poll);
        } catch { clearInterval(poll); }
      }, 1500);
      trackJob(res.job_id, (job) => {
        clearInterval(poll);
        if (job.status === 'completed') {
          setRun({ phase: 'done', progress: 100, stage: '', error: '', result: job.result });
          refreshData();
          if (job.result?.document_id) notify(`“${job.result.title}” is ready`, 'success', { action: { label: 'Read', onClick: () => { onClose(); navigate(`/read/${job.result.document_id}`); } } });
        } else {
          setRun({ phase: 'error', progress: 0, stage: '', error: job.error || 'Transcription failed', result: null });
        }
      });
    } catch (err) {
      setRun({ phase: 'error', progress: 0, stage: '', error: err.message, result: null });
    }
  };

  if (status.loading && !cfg) return <p className="muted small"><Loader2 size={14} className="spin" /> Checking the speech service…</p>;

  if (cfg && !cfg.configured) {
    return (
      <div className="transcribe-off">
        <Mic size={26} />
        <h3>Audio transcription isn’t switched on here</h3>
        <p>ReadVibe transcribes with NVIDIA’s <strong>Nemotron-3.5-Transcribe</strong> model. It is a 34-billion-parameter model that needs a GPU server (one H100 80 GB), so it runs on a server you connect, not inside the app.</p>
        <p>Serve it with vLLM as described on the model’s Hugging Face page, then set <code>READVIBE_TRANSCRIBE_BASE_URL</code> on the ReadVibe API to that server’s <code>/v1</code> address.</p>
      </div>
    );
  }

  if (run.phase === 'done' && run.result) {
    const r = run.result;
    return (
      <div className="transcribe-result">
        <div className="transcribe-text" tabIndex={0}>{r.text}</div>
        {r.words?.length > 0 && <small className="muted">{r.words.length} words with timestamps</small>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={() => navigator.clipboard?.writeText(r.text).then(() => notify('Transcript copied'))}><Copy size={14} /> Copy</button>
          <button className="secondary-button" onClick={() => { setFile(null); setRun({ phase: 'idle', progress: 0, stage: '', error: '', result: null }); }}>Transcribe another</button>
          {r.document_id && <button className="primary-button" onClick={() => { onClose(); navigate(`/read/${r.document_id}`); }}><BookOpen size={15} /> Read transcript</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="transcribe-form">
      <div className="drop-zone" role="button" tabIndex={0} onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
        aria-label="Choose an audio file, or drop it here">
        <input ref={inputRef} type="file" hidden accept={FORMATS.map((f) => `.${f}`).join(',')} onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ''; }} />
        {file ? (
          <>
            <FileAudio size={28} />
            <p><strong>{file.name}</strong> · {formatBytes(file.size)}</p>
            {fileError ? <small className="field-error"><AlertCircle size={11} /> {fileError}</small> : <small className="muted">Click to choose a different file</small>}
          </>
        ) : (
          <>
            <FileAudio size={30} />
            <p>Drop a recording here, or <span className="browse-link">browse</span></p>
            <div className="supported-formats">{FORMATS.map((f) => <span key={f} className="format-badge">{f.toUpperCase()}</span>)}</div>
            <small>Up to {limitMb} MB · up to an hour of speech · 40 languages</small>
          </>
        )}
      </div>

      <Field label="Style">
        <Segmented size="sm" value={opts.style} onChange={(style) => setOpts({ ...opts, style })} label="Transcript style" options={STYLES} />
      </Field>
      <div className="form-row">
        <Field label="Translate to" hint="Optional. Leave blank to keep the spoken language.">
          <select className="input" value={opts.translate_to} onChange={(e) => setOpts({ ...opts, translate_to: e.target.value })}>
            <option value="">Keep the spoken language</option>
            {TRANSLATE_TO.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Names & terms" hint="Optional. Helps with jargon and names.">
          <input className="input" value={opts.context} maxLength={400} placeholder="e.g. Kubernetes, Dr. Iyer" onChange={(e) => setOpts({ ...opts, context: e.target.value })} />
        </Field>
      </div>
      <label className="check-row"><input type="checkbox" checked={opts.save} onChange={(e) => setOpts({ ...opts, save: e.target.checked })} /> Save the transcript to my library so I can read, listen and ask Vibe about it</label>

      {busy && <div><ProgressBar value={run.progress} thin /><small className="muted">{run.stage}</small></div>}
      {run.error && <small className="field-error"><AlertCircle size={11} /> {run.error}</small>}
      <div className="modal-actions">
        {file && !busy && <button className="icon-ghost sm" onClick={() => setFile(null)} aria-label="Remove file"><X size={14} /></button>}
        <button className="primary-button" onClick={start} disabled={!file || !!fileError || busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Mic size={15} />} {busy ? 'Transcribing…' : 'Transcribe'}
        </button>
      </div>
    </div>
  );
}
