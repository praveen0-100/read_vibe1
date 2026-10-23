import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';

/**
 * Natural (neural) voices from the server.
 *   neural      — {synth, voice} for the default (English) voice, or null when natural voices are off / unavailable
 *   languages   — the server's language catalogue, Tamil · Telugu · Malayalam · Kannada first
 *   neuralFor   — neuralFor('ta') → {synth, voice} using the user's chosen Tamil voice (else the default Tamil voice);
 *                 null when natural voices are off or that language has no neural voice
 *   voiceFor    — voiceFor('ta', 0) → voice id for host 0 (female) / 1 (male) of that language
 */
export function useNaturalVoice() {
  const { prefs } = useApp();
  const [available, setAvailable] = useState(false);
  const [languages, setLanguages] = useState([]);

  useEffect(() => {
    let live = true;
    api.tts.status().then((s) => live && setAvailable(!!s.available)).catch(() => live && setAvailable(false));
    api.tts.languages().then((l) => live && setLanguages(l)).catch(() => {});
    return () => { live = false; };
  }, []);

  const { engine, naturalVoice, langVoices } = prefs.audio;
  const on = available && engine !== 'device';

  const voiceFor = useCallback((code, slot = 0) => {
    const lang = languages.find((l) => l.code === code);
    if (!lang?.voices.length) return null;
    if (slot === 0) {
      const chosen = (code === 'en' ? naturalVoice : langVoices?.[code]);
      if (chosen && lang.voices.some((v) => v.id === chosen)) return chosen;
      if (code === 'en' && naturalVoice) return naturalVoice; // any English voice from the full catalogue
    }
    return (lang.voices[slot] || lang.voices[0]).id;
  }, [languages, naturalVoice, langVoices]);

  const neuralFor = useCallback((code) => {
    if (!on) return null;
    const voice = voiceFor(code || 'en', 0);
    return voice ? { synth: api.tts.synthesize, voice } : null;
  }, [on, voiceFor]);

  const neural = useMemo(() => (on ? { synth: api.tts.synthesize, voice: naturalVoice } : null), [on, naturalVoice]);

  return { neural, on, available, languages, neuralFor, voiceFor };
}
