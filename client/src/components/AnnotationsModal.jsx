import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../api/client';
import { insightApi } from '../api/endpoints';
import { fmt } from '../utils/format';
import { UPDATE_COLORS } from './charts/TrendChart';
import { Modal, Spinner } from './ui/Feedback';
import { useToast } from './ui/Toast';

const today = () => new Date().toISOString().slice(0, 10);

/** Grafik notları: kullanıcı notu ekle/sil, dönemdeki Google güncellemeleri ve sayfa değişiklikleri listesi. */
export default function AnnotationsModal({ domainId, data, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ date: today(), title: '', detail: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['annotations', domainId] });

  const add = useMutation({
    mutationFn: () => insightApi.addAnnotation(domainId, { ...form, detail: form.detail || null }),
    onSuccess: () => {
      toast.success('Not eklendi');
      setForm((f) => ({ ...f, title: '', detail: '' }));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id) => insightApi.removeAnnotation(domainId, id),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const notes = data?.notes || [];
  const updates = data?.updates || [];
  return (
    <Modal title="Grafik notları" onClose={onClose} width={640}>
      <div className="stack" style={{ gap: 18 }}>
        <form
          className="card card-pad" style={{ display: 'grid', gap: 10, background: 'var(--surface-2)' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (form.title.trim()) add.mutate();
          }}
        >
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ width: 160 }}>
              <label htmlFor="note-date">Tarih</label>
              <input id="note-date" type="date" className="input input-sm" value={form.date} max={today()} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="note-title">Ne oldu?</label>
              <input
                id="note-title" className="input input-sm" maxLength={120} placeholder="Ör. Yeni tasarım yayına alındı, blog kategorisi taşındı"
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required
              />
            </div>
          </div>
          <input className="input input-sm" maxLength={500} placeholder="Açıklama (isteğe bağlı)" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
          <div><button className="btn btn-primary btn-sm" disabled={add.isPending || !form.title.trim()}>{add.isPending ? <Spinner size={14} /> : <Plus size={15} />} Not ekle</button></div>
        </form>

        <div>
          <h4 style={{ marginBottom: 8 }}>Notlarınız</h4>
          {notes.length ? (
            <div className="url-list">
              {[...notes].reverse().map((n) => (
                <div key={n.id} style={{ alignItems: 'center' }}>
                  <span style={{ minWidth: 0 }}>
                    <strong className="num">{fmt.dateShort(n.date)}</strong> · {n.title}
                    {n.detail && <span className="muted"> — {n.detail}</span>}
                  </span>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => remove.mutate(n.id)} aria-label="Notu sil" disabled={remove.isPending}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          ) : <p className="muted">Bu dönemde not yok. Site değişikliklerini not almak, trafik değişimlerinin nedenini sonradan anlamayı kolaylaştırır.</p>}
        </div>

        <div>
          <h4 style={{ marginBottom: 8 }}>Google sıralama güncellemeleri</h4>
          {updates.length ? (
            <div className="url-list">
              {updates.map((u) => (
                <div key={u.name}>
                  <span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: UPDATE_COLORS[u.kind] }} /> {u.name}</span>
                  <span className="muted num">{fmt.dateShort(u.start)} – {u.end ? fmt.dateShort(u.end) : 'sürüyor'}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">Bu dönemde Google güncellemesi yok.</p>}
          <p className="hint" style={{ marginTop: 6 }}>Kaynak: Google Search Status Dashboard (otomatik güncellenir).</p>
        </div>
      </div>
    </Modal>
  );
}
