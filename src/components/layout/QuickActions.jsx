// Quick actions (upload, continue reading, generate audio, ask AI).
// Desktop/tablet: a floating "+" in the bottom corner. Phones: the same menu opened from the header (`inline`), so nothing
// floats over the content or collides with the mini player and tab bar.
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Headphones, Plus, Sparkles, Upload, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useClickOutside } from '../../hooks/useAsync';

export default function QuickActions({ inline = false }) {
  const { setUploadOpen, openAI } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const actions = [
    { label: 'Upload document', icon: Upload, run: () => setUploadOpen(true) },
    { label: 'Continue reading', icon: BookOpen, run: () => navigate('/read') },
    { label: 'Generate audio', icon: Headphones, run: () => navigate('/audio?tab=generate') },
    { label: 'Ask AI', icon: Sparkles, run: () => openAI({ tab: 'chat' }) },
  ];
  return (
    <div className={`quick-actions ${inline ? 'inline' : ''} ${open ? 'open' : ''}`} ref={ref}>
      {open && (
        <div className="quick-menu" role="menu">
          {actions.map((a) => (
            <button key={a.label} role="menuitem" onClick={() => { setOpen(false); a.run(); }}>
              <span>{a.label}</span><i><a.icon size={16} /></i>
            </button>
          ))}
        </div>
      )}
      <button className="quick-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close quick actions' : 'Quick actions'} aria-expanded={open}>
        {open ? <X size={inline ? 18 : 22} /> : <Plus size={inline ? 18 : 22} />}
      </button>
    </div>
  );
}
