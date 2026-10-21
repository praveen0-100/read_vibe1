// ─── Collaborative audiobook studio ──────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, CircleDot, Download, Loader2, Mic, Plus, RotateCcw, Square, Trash2, Upload, UserPlus, Users, Wand2, X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { stitch } from '../../lib/audioStitch';
import { formatClock, initials, timeAgo } from '../../lib/format';
import { EmptyState, ErrorState, Field, Modal, ProgressBar, Skeleton, Switch } from '../ui';

const STEPS = ['Create project', 'Invite collaborators', 'Assign chapters', 'Record parts', 'Review', 'AI cleanup & stitch'];

function Recorder({ project, assignment, onClose, onUploaded }) {
  const { notify } = useApp();
  const [phase, setPhase] = useState('idle'); // idle | recording | review | uploading
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState(null);
  const [progress, setProgress] = useState(0);
  const [script, setScript] = useState('');
  const rec = useRef(null);
  const stream = useRef(null);
  const raf = useRef(0);
  const audioCtx = useRef(null);

  useEffect(() => {
    if (project.document_id != null && assignment.chapter_index != null) {
      api.documents.chapter(project.document_id, assignment.chapter_index).then((c) => setScript(c.content)).catch(() => {});
    }
    return () => stop(true);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      notify('Microphone access was blocked. Allow it in your browser settings to record.', 'error');
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx.current = new Ctx();
    const analyser = audioCtx.current.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.current.createMediaStreamSource(stream.current).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      setLevel(peak / 128);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    const chunks = [];
    rec.current = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    rec.current.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.current.onstop = () => setBlob(new Blob(chunks, { type: rec.current.mimeType || 'audio/webm' }));
    rec.current.start(1000);
    setSeconds(0);
    setPhase('recording');
  };

  function stop(silent = false) {
    cancelAnimationFrame(raf.current);
    if (rec.current?.state === 'recording') rec.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    if (!silent) setPhase('review');
  }

  const upload = async () => {
    setPhase('uploading');
    try {
      const res = await api.audio.collab.upload(project.id, assignment.id, blob, seconds, setProgress);
      notify(`“${assignment.title}” recording saved`);
      onUploaded(res.project);
      onClose();
    } catch (err) {
      notify(err.message, 'error');
      setPhase('review');
    }
  };

  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);

  return (
    <Modal open onClose={() => { stop(true); onClose(); }} eyebrow={`RECORDING · ${project.title}`} title={assignment.title} icon={Mic} size="lg">
      {!window.MediaRecorder && <p className="field-error">Recording isn’t supported in this browser.</p>}
      {script && <div className="teleprompter" aria-label="Chapter script">{script.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div>}
      <div className="recorder">
        <div className={`rec-meter ${phase === 'recording' ? 'live' : ''}`} aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => <i key={i} style={{ opacity: level * 24 > i ? 1 : 0.15 }} />)}
        </div>
        <div className="rec-time">{phase === 'recording' && <CircleDot size={14} className="rec-dot" />} {formatClock(seconds)}</div>
        <div className="rec-buttons">
          {phase === 'idle' && <button className="primary-button" onClick={start}><Mic size={15} /> Start recording</button>}
          {phase === 'recording' && <button className="primary-button danger" onClick={() => stop()}><Square size={14} /> Stop</button>}
          {phase === 'review' && (
            <>
              <audio controls src={url} className="rec-audio" />
              <button className="secondary-button" onClick={() => { setBlob(null); setPhase('idle'); }}><RotateCcw size={14} /> Re-record</button>
              <button className="primary-button" onClick={upload} disabled={!blob}><Upload size={14} /> Save take</button>
            </>
          )}
          {phase === 'uploading' && <div className="rec-upload"><ProgressBar value={progress} /><small>Uploading… {progress}%</small></div>}
        </div>
        <p className="fineprint">Tip: record in a quiet room about a hand’s width from the mic. Echo cancellation and noise suppression are on.</p>
      </div>
    </Modal>
  );
}

function ProjectView({ projectId, onBack }) {
  const { notify, confirm } = useApp();
  const proj = useQuery(() => api.audio.collab.list().then((l) => l.find((p) => p.id === projectId)), [projectId]);
  const [invite, setInvite] = useState({ name: '', email: '', role: 'Narrator' });
  const [recording, setRecording] = useState(null);
  const [stitching, setStitching] = useState(null);
  const [cleanup, setCleanup] = useState(true);
  const [output, setOutput] = useState(null);
  const p = proj.data;
  useEffect(() => () => output && URL.revokeObjectURL(output.url), [output]);

  if (proj.error) return <ErrorState error={proj.error} onRetry={proj.reload} />;
  if (!p) return <Skeleton h={300} />;

  const save = async (patch) => {
    try { proj.setData(await api.audio.collab.update(p.id, patch)); } catch (err) { notify(err.message, 'error'); }
  };
  const addCollaborator = (e) => {
    e.preventDefault();
    if (!invite.name.trim()) return;
    save({ collaborators: [...p.collaborators, { ...invite, name: invite.name.trim() }] });
    notify(`${invite.name} added to the project`);
    setInvite({ name: '', email: '', role: 'Narrator' });
  };
  const removeCollaborator = (c) => save({
    collaborators: p.collaborators.filter((x) => x.id !== c.id),
    assignments: p.assignments.map((a) => (a.collaborator_id === c.id ? { ...a, collaborator_id: null, status: a.recording_id ? 'recorded' : 'unassigned' } : a)),
  });
  const assign = (a, cid) => save({ assignments: p.assignments.map((x) => (x.id === a.id ? { ...x, collaborator_id: cid || null, status: x.recording_id ? 'recorded' : cid ? 'assigned' : 'unassigned' } : x)) });
  const addPart = () => save({ assignments: [...p.assignments, { title: `Part ${p.assignments.length + 1}`, chapter_index: null, collaborator_id: null, status: 'unassigned', recording_id: null }] });
  const removeRecording = async (a) => {
    if (!(await confirm({ title: 'Delete this recording?', confirmLabel: 'Delete', danger: true }))) return;
    await api.audio.collab.removeRecording(p.id, a.recording_id).catch((e) => notify(e.message, 'error'));
    proj.reload();
  };

  const recorded = p.assignments.filter((a) => a.recording_id);
  const pct = p.assignments.length ? (recorded.length / p.assignments.length) * 100 : 0;
  const stepIndex = p.collaborators.length < 2 ? 1 : !p.assignments.some((a) => a.collaborator_id) ? 2 : recorded.length < p.assignments.length ? 3 : 5;

  const runStitch = async () => {
    setStitching(0);
    try {
      const parts = await Promise.all(recorded.map((a) => api.audio.collab.fetchRecording(p.id, a.recording_id)));
      const { blob, seconds } = await stitch(parts, { cleanup, onProgress: setStitching });
      setOutput({ url: URL.createObjectURL(blob), blob, seconds });
      if (recorded.length === p.assignments.length) save({ status: 'complete' });
      notify('Your audiobook is stitched and ready');
    } catch (err) {
      notify(`Stitching failed: ${err.message}`, 'error');
    } finally { setStitching(null); }
  };

  const byId = Object.fromEntries(p.collaborators.map((c) => [c.id, c]));

  return (
    <div className="collab-project">
      <button className="back-link" onClick={onBack}><ArrowLeft size={14} /> All projects</button>
      <div className="collab-header">
        <div>
          <div className="eyebrow">COLLABORATIVE AUDIOBOOK</div>
          <h2>{p.title}</h2>
          <p className="muted">{recorded.length} of {p.assignments.length} parts recorded · updated {timeAgo(p.updated_at)}</p>
        </div>
        <ProgressBar value={pct} />
      </div>
      <ol className="collab-steps">
        {STEPS.map((s, i) => <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}><span>{i < stepIndex ? <Check size={12} /> : i + 1}</span>{s}</li>)}
      </ol>

      <div className="collab-grid">
        <section className="panel-card">
          <h3><Users size={15} /> Collaborators</h3>
          <ul className="collab-people">
            {p.collaborators.map((c, i) => (
              <li key={c.id}>
                <span className="avatar sm">{initials(c.name)}</span>
                <span><strong>{c.name}</strong><small>{c.role}{c.email ? ` · ${c.email}` : ''}</small></span>
                <small className="muted">{p.assignments.filter((a) => a.collaborator_id === c.id).length} parts</small>
                {i > 0 && <button className="icon-ghost sm" onClick={() => removeCollaborator(c)} aria-label={`Remove ${c.name}`}><X size={13} /></button>}
              </li>
            ))}
          </ul>
          <form className="invite-form" onSubmit={addCollaborator}>
            <input className="input" placeholder="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} aria-label="Collaborator name" />
            <input className="input" type="email" placeholder="Email (optional)" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} aria-label="Collaborator email" />
            <select className="input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} aria-label="Role">
              {['Narrator', 'Character voice', 'Editor'].map((r) => <option key={r}>{r}</option>)}
            </select>
            <button className="secondary-button" disabled={!invite.name.trim()}><UserPlus size={14} /> Add</button>
          </form>
          <p className="fineprint">Collaborators record on this device during a session together. Share the finished file with everyone.</p>
        </section>

        <section className="panel-card">
          <div className="panel-card-head">
            <h3><Mic size={15} /> Assignment board</h3>
            <button className="text-button" onClick={addPart}><Plus size={12} /> Add part</button>
          </div>
          <ul className="assignments">
            {p.assignments.map((a, i) => (
              <li key={a.id} className={`assignment ${a.status}`}>
                <span className="ch-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="assignment-title">{a.title}</span>
                <select value={a.collaborator_id || ''} onChange={(e) => assign(a, e.target.value)} aria-label={`Assign ${a.title}`}>
                  <option value="">Unassigned</option>
                  {p.collaborators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span className={`status-pill ${a.status}`}>{a.status}</span>
                <span className="assignment-actions">
                  {a.recording_id && <audio controls preload="none" src={api.audio.collab.recordingUrl(p.id, a.recording_id)} />}
                  <button className={a.recording_id ? 'icon-ghost sm' : 'secondary-button small'} onClick={() => setRecording(a)} aria-label={a.recording_id ? 'Re-record' : `Record ${a.title}`}>
                    {a.recording_id ? <RotateCcw size={13} /> : <><Mic size={13} /> Record</>}
                  </button>
                  {a.recording_id && <button className="icon-ghost sm" onClick={() => removeRecording(a)} aria-label="Delete recording"><Trash2 size={13} /></button>}
                  {a.collaborator_id && <span className="avatar xs" title={byId[a.collaborator_id]?.name}>{initials(byId[a.collaborator_id]?.name)}</span>}
                </span>
              </li>
            ))}
          </ul>
          {p.assignments.length === 0 && <p className="muted small">Add parts to record, or create the project from a document to get one part per chapter.</p>}
        </section>
      </div>

      <section className="panel-card stitch-card">
        <div>
          <h3><Wand2 size={15} /> Final timeline</h3>
          <p className="muted small">Trims silence, reduces background noise, normalises loudness, then joins every recorded part in order.</p>
          <div className="timeline">
            {p.assignments.map((a) => <span key={a.id} className={a.recording_id ? 'filled' : ''} title={a.title} style={{ flex: Math.max(1, recordedDuration(p, a)) }} />)}
          </div>
          <Switch label="AI cleanup (silence trim + noise gate)" checked={cleanup} onChange={setCleanup} />
        </div>
        <div className="stitch-actions">
          {stitching != null ? (
            <><Loader2 size={16} className="spin" /> <ProgressBar value={stitching} /></>
          ) : (
            <button className="primary-button" onClick={runStitch} disabled={!recorded.length}><Wand2 size={15} /> Stitch {recorded.length} part{recorded.length === 1 ? '' : 's'}</button>
          )}
          {output && (
            <div className="stitch-output">
              <audio controls src={output.url} />
              <a className="secondary-button" href={output.url} download={`${p.title}.wav`}><Download size={14} /> Download WAV · {formatClock(output.seconds)}</a>
            </div>
          )}
        </div>
      </section>

      {recording && <Recorder project={p} assignment={recording} onClose={() => setRecording(null)} onUploaded={(np) => proj.setData(np)} />}
    </div>
  );
}

function recordedDuration(p, a) {
  return p.recordings?.find((r) => r.id === a.recording_id)?.duration_seconds || 1;
}

export default function CollabStudio() {
  const { notify, confirm, dataVersion } = useApp();
  const projects = useQuery(() => api.audio.collab.list(), [dataVersion]);
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), []);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', document_id: '' });

  if (open) return <ProjectView projectId={open} onBack={() => { setOpen(null); projects.reload(); }} />;

  const create = async (e) => {
    e.preventDefault();
    try {
      const p = await api.audio.collab.create({ title: form.title.trim(), document_id: form.document_id || null });
      setCreating(false);
      setForm({ title: '', document_id: '' });
      setOpen(p.id);
    } catch (err) { notify(err.message, 'error'); }
  };
  const remove = async (p) => {
    if (!(await confirm({ title: `Delete “${p.title}”?`, message: 'All recordings in this project will be deleted.', confirmLabel: 'Delete', danger: true }))) return;
    await api.audio.collab.remove(p.id).catch((er) => notify(er.message, 'error'));
    projects.setData((l) => l.filter((x) => x.id !== p.id));
  };

  return (
    <div className="collab-studio">
      <div className="collab-hero">
        <div className="collab-icon"><Users size={28} /></div>
        <div>
          <h3>Collaborative Audiobook Studio</h3>
          <p>Record with friends — assign chapters or characters, record each part, then let ReadVibe clean, normalise and stitch everything into one audiobook.</p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> New project</button>
      </div>
      {projects.error && <ErrorState error={projects.error} onRetry={projects.reload} />}
      {projects.data?.length === 0 && (
        <EmptyState icon={Mic} title="No collaborative projects yet." description="Start one from a document to get a recording slot for every chapter." action="New project" onAction={() => setCreating(true)} />
      )}
      <div className="collab-list">
        {(projects.data || []).map((p) => {
          const done = p.assignments.filter((a) => a.recording_id).length;
          return (
            <div key={p.id} className="collab-card">
              <button className="collab-card-main" onClick={() => setOpen(p.id)}>
                <strong>{p.title}</strong>
                <small>{p.collaborators.length} collaborator{p.collaborators.length === 1 ? '' : 's'} · {done}/{p.assignments.length} parts recorded</small>
                <ProgressBar value={p.assignments.length ? (done / p.assignments.length) * 100 : 0} thin />
              </button>
              <span className={`status-pill ${p.status}`}>{p.status}</span>
              <button className="icon-ghost sm" onClick={() => remove(p)} aria-label={`Delete ${p.title}`}><Trash2 size={14} /></button>
            </div>
          );
        })}
      </div>
      {creating && (
        <Modal open onClose={() => setCreating(false)} eyebrow="NEW PROJECT" title="Start a collaborative audiobook" icon={Users}>
          <form className="stack" onSubmit={create}>
            <Field label="Project name"><input className="input" required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Our audiobook" /></Field>
            <Field label="Source document" hint="Optional — creates one recording part per chapter, with the text shown as a teleprompter.">
              <select className="input" value={form.document_id} onChange={(e) => setForm({ ...form, document_id: e.target.value, title: form.title || (docs.data || []).find((d) => d.id === e.target.value)?.title || '' })}>
                <option value="">No document — I’ll add parts manually</option>
                {(docs.data || []).filter((d) => d.status === 'ready').map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </Field>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary-button" disabled={!form.title.trim()}>Create project</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
