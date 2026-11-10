// The AI's short explanation of a term (from /lookup and /ai/define): meaning, the plain-words version, an example and — when a
// passage was known — what the word means *there*. Shown above the dictionary because it works for phrases, names and every language.
import React from 'react';
import { Sparkles } from 'lucide-react';

export default function AIMeaning({ ai }) {
  if (!ai?.meaning) return null;
  return (
    <section className="ai-meaning" aria-label="AI meaning">
      <h4><Sparkles size={14} /> Meaning{ai.part_of_speech && <em> · {ai.part_of_speech}</em>}</h4>
      <p className="am-main">{ai.meaning}</p>
      {ai.in_context && <p className="am-ctx"><b>Here:</b> {ai.in_context}</p>}
      {ai.simple && <p className="am-simple"><b>In simple words:</b> {ai.simple}</p>}
      {ai.example && <blockquote className="am-example">“{ai.example}”</blockquote>}
      {ai.engine && <small className="am-engine">{ai.engine}</small>}
    </section>
  );
}
