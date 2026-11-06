// Collections (shelves): filter the library by a shelf, create/rename/delete shelves. Removing a shelf never removes its documents.
import React, { useState } from 'react';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Field, Modal } from '../ui';

const COLORS = ['coral', 'blue', 'lavender', 'amber', 'green', 'rose'];

export function useCollections() {
  const [version, setVersion] = useState(0);
  const [list, setList] = useState(null);
  React.useEffect(() => { let live = true; api.collections.list().then((l) => live && setList(l)).catch(() => live && setList([])); return () => { live = false; }; }, [version]);
  return { list: list || [], reload: () => setVersion((v) => v + 1) };
}

export function CollectionModal({ collection, onClose, onSaved }) {
  const { notify, confirm } = useApp();
  const [name, setName] = useState(collection?.name || '');
  const [color, setColor] = useState(collection?.color || 'coral');
  const save = async (e) => {
    e.preventDefault();
    try {
      const saved = collection ? await api.collections.update(collection.id, { name, color }) : await api.collections.create({ name, color });
      onSaved(saved); onClose();
    } catch (err) { notify(err.message, 'error'); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete the collection “${collection.name}”?`, message: 'Your documents are not deleted.', confirmLabel: 'Delete', danger: true }))) return;
    try { await api.collections.remove(collection.id); onSaved(null); onClose(); } catch (err) { notify(err.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={collection ? 'Edit collection' : 'New collection'} size="sm"
      footer={<>{collection && <button className="secondary-button danger" onClick={remove}><Trash2 size={14} /> Delete</button>}<button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" form="colform" disabled={!name.trim()}>Save</button></>}>
      <form id="colform" className="stack" onSubmit={save}>
        <Field label="Name"><input className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Semester 7" /></Field>
        <Field label="Colour">
          <div className="color-picker">{COLORS.map((c) => <button type="button" key={c} className={`swatch cover-${c} ${color === c ? 'chosen' : ''}`} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} />)}</div>
        </Field>
      </form>
    </Modal>
  );
}

export default function CollectionsBar({ collections, active, onPick, onChanged }) {
  const [editing, setEditing] = useState(null); // null | 'new' | collection
  return (
    <div className="collections-bar" role="group" aria-label="Collections">
      {collections.map((c) => (
        <span key={c.id} className={`col-chip cover-${c.color} ${active === c.id ? 'on' : ''}`}>
          <button onClick={() => onPick(active === c.id ? null : c.id)} aria-pressed={active === c.id}>{c.name} <small>{c.count}</small></button>
          {active === c.id && <button className="col-edit" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}><Pencil size={11} /></button>}
        </span>
      ))}
      <button className="col-new" onClick={() => setEditing('new')}><FolderPlus size={13} /> New collection</button>
      {editing && <CollectionModal collection={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(saved) => { if (!saved) onPick(null); onChanged(); }} />}
    </div>
  );
}
