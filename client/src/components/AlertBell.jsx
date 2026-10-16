import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { alertApi } from '../api/endpoints';
import { fmt } from '../utils/format';
import { SeverityBadge } from './ui/Feedback';

const TAB = { traffic_drop: '', rank_drop: 'keywords', new_critical_issues: 'health', site_down: 'health', indexing_blocked: 'health', ssl_expiry: 'health', backlinks_lost: 'backlinks' };

/** Üst bardaki bildirimler: otomatik izlemenin ürettiği uyarılar (2 dakikada bir yenilenir). */
export default function AlertBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { data } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertApi.list({ pageSize: 30 }),
    refetchInterval: 120_000,
  });
  const read = useMutation({
    mutationFn: (id) => alertApi.read(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = data?.unread || 0;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-ghost btn-icon" onClick={() => setOpen((o) => !o)} aria-label={`Bildirimler (${unread} okunmamış)`} aria-expanded={open} title="Bildirimler">
        <Bell size={18} />
        {unread > 0 && (
          <span className="num" style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--critical)', color: '#fff', fontSize: 10.5, display: 'grid', placeItems: 'center', padding: '0 4px' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card" role="dialog" aria-label="Bildirimler" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 'min(420px, calc(100vw - 32px))', maxHeight: 520, overflowY: 'auto', zIndex: 50, boxShadow: 'var(--shadow-lg)' }}>
          <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
            <h3 style={{ fontSize: 15 }}>Bildirimler</h3>
            {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={() => read.mutate(null)}><CheckCheck size={15} /> Tümünü okundu say</button>}
          </div>
          <div style={{ display: 'grid' }}>
            {(data?.rows || []).map((a) => (
              <Link
                key={a.id}
                to={a.domain_id ? `/domains/${a.domain_id}/${TAB[a.type] ?? ''}` : '#'}
                onClick={() => { if (!a.read_at) read.mutate(a.id); setOpen(false); }}
                style={{ display: 'grid', gap: 4, padding: '12px 20px', borderTop: '1px solid var(--border)', color: 'inherit', background: a.read_at ? undefined : 'var(--primary-soft)' }}
              >
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <SeverityBadge severity={a.severity} />
                  <strong className="truncate" style={{ fontSize: 13.5 }}>{a.title}</strong>
                </div>
                {a.detail && <div className="text-2" style={{ fontSize: 12.5, whiteSpace: 'pre-line' }}>{a.detail}</div>}
                <div className="muted" style={{ fontSize: 11.5 }}>{a.hostname} · {fmt.dateTime(a.created_at)}</div>
              </Link>
            ))}
            {!data?.rows?.length && <p className="muted" style={{ padding: 20 }}>Henüz bildirim yok. Otomatik izleme sorun tespit ettiğinde burada görünecek.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
