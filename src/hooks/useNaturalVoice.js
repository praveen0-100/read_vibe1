import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';

// {synth, voice} for Narrator.load({ neural }) when natural voices are on and the server offers them; otherwise null.
export function useNaturalVoice() {
  const { prefs } = useApp();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    api.tts.status().then((s) => live && setAvailable(!!s.available)).catch(() => live && setAvailable(false));
    return () => { live = false; };
  }, []);
  const { engine, naturalVoice } = prefs.audio;
  return useMemo(
    () => (available && engine !== 'device' ? { synth: api.tts.synthesize, voice: naturalVoice } : null),
    [available, engine, naturalVoice],
  );
}
