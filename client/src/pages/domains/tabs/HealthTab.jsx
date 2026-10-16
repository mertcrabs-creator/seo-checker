import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronRight, FileSearch, Play, Wrench } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { domainApi } from '../../../api/endpoints';
import { Alert, Delta, EmptyState, ScoreRing, SeverityBadge, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, safeHref, shortUrl } from '../../../utils/format';

const IssueRow = memo(function IssueRow({ issue, domainId, auditId }) {
  const [open, setOpen] = useState(false);
  const details = useQuery({
    queryKey: ['audit-issue', auditId, issue.code],
    queryFn: () => domainApi.auditIssue(domainId, auditId, issue.code),
    enabled: open,
    staleTime: Infinity,
  });
  return (
    <div className="issue">
      <button className="issue-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={18} className="muted" /> : <ChevronRight size={18} className="muted" />}
        <SeverityBadge severity={issue.severity} />
        <span className="issue-title">{issue.title}</span>
        <span className="badge badge-neutral" style={{ flex: 'none' }}>{issue.categoryLabel}</span>
        <span className="num muted" style={{ flex: 'none', minWidth: 74, textAlign: 'right' }}>
          {issue.siteLevel ? 'Site geneli' : `${fmt.num(issue.pages)} sayfa`}
        </span>
      </button>
      {open && (
        <div className="issue-body">
          <p className="text-2">{issue.description}</p>
          <div className="issue-fix">
            <Wrench size={16} />
            <div><strong>Nasıl çözülür: </strong>{issue.fix}</div>
          </div>
          {!issue.siteLevel && (
            <div className="url-list">
              {details.isLoading ? (
                <div><Spinner size={14} /></div>
              ) : (
                (details.data?.items || []).map((it, i) => (
                  <div key={`${it.url}-${i}`}>
                    <a href={safeHref(it.url)} target="_blank" rel="noopener noreferrer" className="truncate" title={it.url}>{shortUrl(it.url)}</a>
                    {it.detail && <span className="muted truncate" style={{ maxWidth: '45%' }} title={it.detail}>{it.detail}</span>}
                  </div>
                ))
              )}
            </div>
          )}
          {issue.siteLevel && issue.sample && <p className="hint">Detay: {issue.sample}</p>}
        </div>
      )}
    </div>
  );
});

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'critical', label: 'Kritik' },
  { key: 'warning', label: 'Uyarı' },
  { key: 'notice', label: 'Bilgi' },
];

export default function HealthTab({ domain }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('');
  const [view, setView] = useState('issues');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', id],
    queryFn: () => domainApi.latestAudit(id),
    refetchInterval: (q) => (['queued', 'running'].includes(q.state.data?.audit?.status) ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: () => domainApi.startAudit(id),
    onSuccess: () => {
      toast.success('Site taraması başladı');
      qc.invalidateQueries({ queryKey: ['audit', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const audit = data?.audit;
  const running = ['queued', 'running'].includes(audit?.status);
  const issues = useMemo(
    () => (data?.issues || []).filter((i) => (filter === 'all' || i.severity === filter) && (!category || i.category === category)),
    [data, filter, category],
  );

  if (isLoading) return <Skeleton height={320} />;

  const startBtn = (
    <button className="btn btn-primary" onClick={() => start.mutate()} disabled={running || start.isPending}>
      {running ? <><Spinner size={15} /> Taranıyor…</> : <><Play size={16} /> {audit ? 'Yeniden tara' : 'Taramayı başlat'}</>}
    </button>
  );

  if (!audit || (audit.status !== 'completed' && !running && audit.status !== 'failed')) {
    return (
      <div className="card">
        <EmptyState icon={FileSearch} title="Site sağlığı taraması yapılmadı" action={startBtn}>
          Tarayıcımız siteyi bir arama motoru gibi gezerek teknik SEO, içerik, indeksleme, güvenlik, yapısal veri ve bağlantı hatalarını tespit eder ve her biri için çözüm yolu sunar.
        </EmptyState>
      </div>
    );
  }

  if (running) {
    return (
      <div className="card">
        <EmptyState icon={Activity} title="Site taranıyor" action={startBtn}>
          Sayfalar keşfediliyor ve analiz ediliyor. Site büyüklüğüne göre bu işlem birkaç dakika sürebilir.
        </EmptyState>
      </div>
    );
  }

  if (audit.status === 'failed') {
    return (
      <div className="stack">
        <Alert type="error">Tarama başarısız oldu: {audit.error}</Alert>
        <div>{startBtn}</div>
      </div>
    );
  }

  const info = audit.site_info || {};
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div className="card card-pad row" style={{ gap: 20, flexWrap: 'nowrap' }}>
          <ScoreRing score={audit.score} size={120} label="Sağlık puanı" />
          <div style={{ display: 'grid', gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Önceki taramaya göre</span>
            {audit.previousScore !== null ? <Delta value={audit.score - audit.previousScore} mode="abs" /> : <span className="muted">—</span>}
            <span className="muted" style={{ fontSize: 12 }}>{fmt.dateTime(audit.finished_at)}</span>
            {startBtn}
          </div>
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ fontSize: 15 }}>Bulgular</h3>
          {['critical', 'warning', 'notice'].map((s) => (
            <div key={s} className="row" style={{ justifyContent: 'space-between' }}>
              <SeverityBadge severity={s} />
              <strong className="num">{fmt.num(data.summary[s])}</strong>
            </div>
          ))}
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          <h3 style={{ fontSize: 15 }}>Tarama özeti</h3>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="text-2">Taranan sayfa</span><strong className="num">{fmt.num(audit.pages_crawled)}</strong></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="text-2">Ort. yanıt süresi</span><strong className="num">{fmt.ms(info.avgLoadMs)}</strong></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="text-2">HTTPS</span><strong>{info.https ? 'Aktif' : 'Yok'}</strong></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="text-2">robots.txt</span><strong>{info.robots?.found ? 'Var' : 'Yok'}</strong></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="text-2">Site haritası</span><strong className="num">{info.sitemap?.found ? `${fmt.num(info.sitemap.urlCount)} URL` : 'Yok'}</strong></div>
          {info.server && <div className="row" style={{ justifyContent: 'space-between' }}><span className="text-2">Sunucu</span><strong className="truncate" style={{ maxWidth: 160 }}>{info.server}</strong></div>}
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${!category ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory('')}>Tüm kategoriler</button>
        {data.categories.map((c) => (
          <button key={c.key} className={`btn btn-sm ${category === c.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory(c.key)}>
            {c.label}
            <span className={`badge ${c.critical ? 'badge-critical' : c.issues ? 'badge-warning' : 'badge-good'}`} style={{ height: 20 }}>{c.issues}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-head" style={{ paddingBottom: 14 }}>
          <div className="segmented">
            <button className={view === 'issues' ? 'active' : ''} onClick={() => setView('issues')}>Sorunlar ({data.issues.length})</button>
            <button className={view === 'pages' ? 'active' : ''} onClick={() => setView('pages')}>Taranan sayfalar ({data.pages.length})</button>
          </div>
          {view === 'issues' && (
            <div className="segmented">
              {FILTERS.map((f) => (
                <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>{f.label}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {view === 'issues' ? (
            issues.length ? (
              issues.map((i) => <IssueRow key={i.code} issue={i} domainId={id} auditId={audit.id} />)
            ) : (
              <EmptyState icon={Activity} title="Bu filtrede sorun yok">Harika! Seçili kategori ve önem derecesinde tespit edilen bir sorun bulunmuyor.</EmptyState>
            )
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>URL</th><th className="r">Durum</th><th>Title</th><th className="r">Kelime</th><th className="r">Yanıt</th><th className="r">Derinlik</th><th className="r">Sorun</th></tr>
                </thead>
                <tbody>
                  {data.pages.map((p) => (
                    <tr key={p.url}>
                      <td className="truncate" style={{ maxWidth: 280 }}><a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" title={p.url}>{shortUrl(p.url)}</a></td>
                      <td className="r">
                        <span className={`badge ${p.status_code === 200 ? 'badge-good' : p.status_code >= 400 || !p.status_code ? 'badge-critical' : 'badge-warning'}`}>{p.status_code ?? 'Hata'}</span>
                      </td>
                      <td className="truncate" style={{ maxWidth: 260 }} title={p.title || ''}>{p.title || <span className="muted">—</span>}</td>
                      <td className="r">{fmt.num(p.word_count)}</td>
                      <td className="r">{fmt.ms(p.load_ms)}</td>
                      <td className="r">{p.depth >= 0 ? p.depth : '—'}</td>
                      <td className="r">{p.issue_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
