// Record a short voice clip in the browser and turn it into text with the transcription model.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const TYPES = [['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/ogg;codecs=opus', 'ogg'], ['audio/mp4', 'm4a']];
const MAX_SECONDS = 90;

/** onText(text) receives the transcript. state: 'idle' | 'recording' | 'working'. */
export function useDictation(onText, onError) {
  const [state, setState] = useState('idle');
  const rec = useRef(null);
  const stream = useRef(null);
  const timer = useRef(null);

  const release = () => { clearTimeout(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => release, []);

  const stop = useCallback(() => { if (rec.current?.state === 'recording') rec.current.stop(); }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { onError?.('Voice input isn’t supported in this browser.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { onError?.('Allow microphone access to dictate.'); return; }
    const [mime, ext] = TYPES.find(([t]) => MediaRecorder.isTypeSupported?.(t)) || ['', 'webm'];
    const recorder = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      release();
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
      if (blob.size < 1500) { setState('idle'); return; } // nothing was said
      setState('working');
      try { onText((await api.transcribe.dictate(blob, ext)).text); }
      catch (err) { onError?.(err.message); }
      finally { setState('idle'); }
    };
    rec.current = recorder;
    recorder.start();
    setState('recording');
    timer.current = setTimeout(stop, MAX_SECONDS * 1000);
  }, [onText, onError, stop]);

  return { state, start, stop, toggle: () => (state === 'recording' ? stop() : state === 'idle' ? start() : undefined) };
}
