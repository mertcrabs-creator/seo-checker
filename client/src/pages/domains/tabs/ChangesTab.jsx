import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, History, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { Pagination } from '../../../components/ui/DataTable';
import { Alert, EmptyState, SeverityBadge, Skeleton } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { useDebounce } from '../../../hooks/useDebounce';
import { fmt, safeHref, shortUrl } from '../../../utils/format';

export const FIELD_LABELS = {
  status_code: 'HTTP durum kodu', noindex: 'İndeksleme', canonical: 'Canonical', title: 'Title', h1: 'H1',
  meta_description: 'Meta açıklama', word_count: 'İçerik uzunluğu (kelime)', robots_blocked: 'robots.txt erişimi',
};
const SEVERITY_VIEWS = [
  { key: '', label: 'Tümü' }, { key: 'critical', label: 'Kritik' }, { key: 'warning', label: 'Önemli' }, { key: 'notice', label: 'Bilgi' },
];
const DAY_VIEWS = [7, 30, 90, 365];

function Value({ value, field }) {
  if (value === null || value === undefined || value === '') return <span className="muted">(yok)</span>;
  if (field === 'canonical') return <a href={safeHref(value)} target="_blank" rel="noopener noreferrer" title={value}>{shortUrl(value)}</a>;
  return <span title={value}>{value}</span>;
}

function WatchCard({ domainId }) {
  const qc = useQueryClient();
  const toast = useToast();
  const watch = useQuery({
    queryKey: ['changes', domainId, 'watch'],
    queryFn: () => insightApi.watch(domainId),
    refetchInterval: (q) => (q.state.data?.running ? 4000 : false),
  });
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && watch.data && !watch.data.running) qc.invalidateQueries({ queryKey: ['changes', domainId] });
    wasRunning.current = Boolean(watch.data?.running);
  }, [watch.data, domainId, qc]);
  const check = useMutation({
    mutationFn: () => insightApi.checkNow(domainId),
    onSuccess: () => {
      toast.success('Önemli sayfalar kontrol ediliyor');
      qc.invalidateQueries({ queryKey: ['changes', domainId, 'watch'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pages = watch.data?.pages || [];
  const problems = pages.filter((p) => p.status_code !== 200 || p.noindex || p.robots_blocked);
  const running = watch.data?.running || check.isPending;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="row" style={{ gap: 8 }}><Eye size={17} /> İzlenen önemli sayfalar</h3>
          <p>
            Ana sayfa ve en çok trafik alan sayfalar düzenli aralıklarla kontrol edilir. noindex, hata kodu, robots.txt engeli veya canonical değişikliğinde anında uyarı gelir.
            {watch.data?.checkedAt && <> · Son kontrol {fmt.dateTime(watch.data.checkedAt)}</>}
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => check.mutate()} disabled={running}>
          <RefreshCw size={15} className={running ? 'spin' : ''} /> {running ? 'Kontrol ediliyor' : 'Şimdi kontrol et'}
        </button>
      </div>
      {problems.length > 0 && (
        <div style={{ padding: '12px 20px 0' }}>
          <Alert type="error">{problems.length} izlenen sayfa şu anda indekslenemez durumda (hata kodu, noindex veya robots.txt engeli).</Alert>
        </div>
      )}
      <div className="table-wrap" style={{ marginTop: 10, maxHeight: 360, overflowY: 'auto' }}>
        {watch.isLoading ? <div style={{ padding: 20 }}><Skeleton height={120} /></div> : pages.length ? (
          <table className="table">
            <thead><tr><th>Sayfa</th><th className="r">Durum</th><th className="r">İndeks</th><th className="r">robots.txt</th></tr></thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.url}>
                  <td style={{ maxWidth: 420 }}>
                    <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="cell-main truncate" style={{ display: 'block' }} title={p.url}>{shortUrl(p.url)}</a>
                    <div className="cell-sub truncate">{p.error || p.title || '—'}</div>
                  </td>
                  <td className="r"><span className={`badge ${p.status_code === 200 ? 'badge-good' : p.status_code >= 300 && p.status_code < 400 ? 'badge-warning' : 'badge-critical'}`}>{p.status_code ?? 'Hata'}</span></td>
                  <td className="r">{p.status_code === 200 ? <span className={`badge ${p.noindex ? 'badge-critical' : 'badge-good'}`}>{p.noindex ? 'noindex' : 'index'}</span> : <span className="muted">—</span>}</td>
                  <td className="r"><span className={`badge ${p.robots_blocked ? 'badge-critical' : 'badge-good'}`}>{p.robots_blocked ? 'Engelli' : 'İzinli'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={Eye} title="Henüz kontrol yapılmadı">İlk kontrol birkaç dakika içinde otomatik başlar; hemen başlatmak için “Şimdi kontrol et”e tıklayın.</EmptyState>
        )}
      </div>
    </div>
  );
}

/** Sayfa değişiklik günlüğü: taramalar arası ve izleme sırasında tespit edilen title/meta/H1/canonical/noindex/durum kodu değişiklikleri. */
export default function ChangesTab({ domain }) {
  const id = domain.id;
  const [severity, setSeverity] = useState('');
  const [field, setField] = useState('');
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 350);
  const params = { days, page, pageSize: 50, ...(severity && { severity }), ...(field && { field }), ...(q && { search: q }) };
  const list = useQuery({ queryKey: ['changes', id, 'list', params], queryFn: () => insightApi.changes(id, params), placeholderData: keepPreviousData });
  const counts = list.data?.counts;
  const reset = (fn) => (v) => {
    fn(v);
    setPage(1);
  };

  return (
    <div className="stack">
      <div className="grid grid-4">
        {[
          ['Kritik', counts?.critical, 'var(--critical)'], ['Önemli', counts?.warning, 'var(--warning)'],
          ['Bilgi', counts?.notice, 'var(--notice-ink)'], ['Değişen sayfa', counts?.pages, 'var(--primary)'],
        ].map(([label, value, color]) => (
          <div key={label} className="card stat">
            <span className="stat-label"><span className="dot" style={{ background: color }} /> {label}</span>
            <span className="stat-value num">{counts ? fmt.num(value) : '—'}</span>
            <span className="stat-foot">Son {days} gün</span>
          </div>
        ))}
      </div>

      <WatchCard domainId={id} />

      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="row" style={{ gap: 8 }}><History size={17} /> Değişiklik günlüğü</h3>
            <p>Taramalar arasında (iki taramada da bulunan sayfalar) ve izleme sırasında tespit edilen değişiklikler.</p>
          </div>
        </div>
        <div className="toolbar">
          <div className="input-icon">
            <Search size={16} />
            <input className="input input-sm" placeholder="URL ara" value={search} onChange={(e) => reset(setSearch)(e.target.value)} aria-label="URL ara" />
          </div>
          <div className="segmented" role="tablist" aria-label="Önem">
            {SEVERITY_VIEWS.map((v) => (
              <button key={v.key} className={severity === v.key ? 'active' : ''} onClick={() => reset(setSeverity)(v.key)} role="tab" aria-selected={severity === v.key}>{v.label}</button>
            ))}
          </div>
          <select className="select select-sm" style={{ width: 190 }} value={field} onChange={(e) => reset(setField)(e.target.value)} aria-label="Alan">
            <option value="">Tüm alanlar</option>
            {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select select-sm" style={{ width: 120 }} value={days} onChange={(e) => reset(setDays)(Number(e.target.value))} aria-label="Dönem">
            {DAY_VIEWS.map((d) => <option key={d} value={d}>Son {d} gün</option>)}
          </select>
        </div>
        <div className="table-wrap">
          {list.isLoading ? <div style={{ padding: 20 }}><Skeleton height={200} /></div> : list.data?.rows.length ? (
            <table className="table">
              <thead><tr><th>Tarih</th><th>Sayfa</th><th>Alan</th><th>Değişiklik</th><th className="r">Önem</th></tr></thead>
              <tbody>
                {list.data.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {fmt.dateTime(c.created_at)}
                      <div className="cell-sub">{c.source === 'monitor' ? 'İzleme' : 'Tarama'}</div>
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      <a href={safeHref(c.url)} target="_blank" rel="noopener noreferrer" className="cell-main truncate" style={{ display: 'block' }} title={c.url}>{shortUrl(c.url)}</a>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{FIELD_LABELS[c.field] || c.field}</td>
                    <td style={{ maxWidth: 460 }}>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                        <span className="truncate muted" style={{ maxWidth: 200, textDecoration: 'line-through' }}><Value value={c.old_value} field={c.field} /></span>
                        <ArrowRight size={14} style={{ flex: 'none', marginTop: 3 }} />
                        <span className="truncate" style={{ maxWidth: 220, fontWeight: 500 }}><Value value={c.new_value} field={c.field} /></span>
                      </div>
                    </td>
                    <td className="r"><SeverityBadge severity={c.severity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={ShieldAlert} title="Değişiklik yok">
              Seçili dönemde değişiklik tespit edilmedi. Her yeni tarama bir öncekiyle, izlenen sayfalar ise her kontrolde son durumla karşılaştırılır.
            </EmptyState>
          )}
        </div>
        {list.data?.total > 50 && <Pagination page={page} pageSize={50} total={list.data.total} onPage={setPage} />}
      </div>
    </div>
  );
}
