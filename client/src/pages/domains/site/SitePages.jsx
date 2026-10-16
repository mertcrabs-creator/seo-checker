import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, ScanSearch, Search, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { domainApi } from '../../../api/endpoints';
import { DataTable, Pagination } from '../../../components/ui/DataTable';
import { EmptyState, Modal, SeverityBadge, Spinner } from '../../../components/ui/Feedback';
import { useTableState } from '../../../hooks/useTableState';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { Flag, NoAuditState, ScorePill } from './shared';

const VIEWS = [
  { key: 'all', label: 'Tümü' },
  { key: 'issues', label: 'Sorunlu' },
  { key: 'thin', label: 'Yetersiz içerik' },
  { key: 'weak_links', label: 'Az iç bağlantı' },
  { key: 'noindex', label: 'noindex' },
  { key: 'errors', label: 'Hatalı' },
];

const columns = [
  {
    key: 'url', label: 'Sayfa', sortable: true,
    render: (r) => (
      <div style={{ minWidth: 0 }}>
        <div className="cell-main truncate" style={{ maxWidth: 340 }} title={r.url}>{shortUrl(r.url)}</div>
        <div className="cell-sub truncate" style={{ maxWidth: 340 }}>{r.title || 'Title yok'}</div>
      </div>
    ),
  },
  { key: 'onpage_score', label: 'Puan', sortable: true, align: 'right', render: (r) => (r.status_code === 200 ? <ScorePill score={r.onpage_score} /> : <span className="badge badge-critical">{r.status_code ?? 'Hata'}</span>) },
  { key: 'kw', label: 'Ana kelime', render: (r) => <span className="truncate" style={{ maxWidth: 200, display: 'inline-block' }}>{r.primary_keyword || <span className="muted">—</span>}</span> },
  { key: 'word_count', label: 'Kelime', sortable: true, align: 'right', render: (r) => fmt.num(r.word_count) },
  { key: 'inlinks', label: 'Gelen iç bağ.', sortable: true, align: 'right', render: (r) => fmt.num(r.inlinks) },
  { key: 'issue_count', label: 'Sorun', sortable: true, align: 'right', render: (r) => fmt.num(r.issue_count) },
  { key: 'load_ms', label: 'Yanıt', sortable: true, align: 'right', render: (r) => fmt.ms(r.load_ms) },
];

const Field = ({ label, value, hint }) => (
  <div style={{ display: 'grid', gap: 2 }}>
    <small className="muted">{label}{hint && <span className="num"> · {hint}</span>}</small>
    <div style={{ wordBreak: 'break-word' }}>{value || <span className="muted">—</span>}</div>
  </div>
);

function PageDetailModal({ domainId, url, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['site', domainId, 'page', url],
    queryFn: () => domainApi.sitePageDetail(domainId, url),
  });
  const p = data?.page;
  return (
    <Modal title="Sayfa analizi" onClose={onClose} width={900}>
      {isLoading || !p ? <Spinner /> : (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="truncate" title={p.url}>{p.url}</a>
            <Link
              className="btn btn-secondary btn-sm" style={{ flex: 'none' }}
              to={`/analyze?url=${encodeURIComponent(p.url)}${p.primary_keyword ? `&keyword=${encodeURIComponent(p.primary_keyword)}` : ''}`}
            >
              <ScanSearch size={15} /> Canlı analiz
            </Link>
          </div>
          <div className="grid grid-4" style={{ gap: 10 }}>
            <div className="metric-tile"><small>Sayfa içi puan</small><strong className="num">{p.onpage_score ?? '—'}</strong></div>
            <div className="metric-tile"><small>Kelime</small><strong className="num">{fmt.num(p.word_count)}</strong></div>
            <div className="metric-tile"><small>Gelen / giden iç bağlantı</small><strong className="num">{fmt.num(p.inlinks)} / {fmt.num(p.internal_links)}</strong></div>
            <div className="metric-tile"><small>Görsel (alt’sız)</small><strong className="num">{fmt.num(p.images)} ({fmt.num(p.images_no_alt)})</strong></div>
          </div>
          <div className="card card-pad" style={{ display: 'grid', gap: 12, fontSize: 13.5 }}>
            <Field label="Title" value={p.title} hint={p.title ? `${p.title.length} karakter` : null} />
            <Field label="Meta açıklama" value={p.meta_description} hint={p.meta_description ? `${p.meta_description.length} karakter` : null} />
            <Field label="H1" value={p.h1} />
            <div className="grid grid-3" style={{ gap: 12 }}>
              <Field label="Ana anahtar kelime" value={p.primary_keyword} />
              <Field label="Canonical" value={p.canonical && (p.canonical === p.url ? 'Kendisi' : shortUrl(p.canonical))} />
              <Field label="İndeksleme" value={`${p.noindex ? 'noindex' : 'İndekslenebilir'} · ${p.in_sitemap ? 'site haritasında' : 'site haritasında değil'}`} />
            </div>
            {!!p.schema_types?.length && <Field label="Yapısal veri" value={p.schema_types.join(', ')} />}
          </div>

          <div>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Sorunlar ve çözümleri ({data.issues.length})</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {data.issues.map((i) => (
                <div key={i.code} className="card card-pad" style={{ display: 'grid', gap: 6 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <SeverityBadge severity={i.severity} />
                    <strong>{i.title}</strong>
                    <span className="badge badge-neutral">{i.categoryLabel}</span>
                  </div>
                  {!!i.details.length && <div className="muted truncate" style={{ fontSize: 12.5 }} title={i.details.join(' · ')}>{i.details.slice(0, 3).join(' · ')}</div>}
                  <div className="issue-fix"><Wrench size={16} /><div>{i.fix}</div></div>
                </div>
              ))}
              {!data.issues.length && <p className="muted">Bu sayfada sorun bulunmadı.</p>}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Sayfanın anahtar kelimeleri</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Kelime</th><th className="r">Geçiş</th><th className="r">Yoğunluk</th><th className="r">Title</th><th className="r">H1</th><th className="r">Başlıklar</th><th className="r">Meta</th><th className="r">URL</th></tr></thead>
                <tbody>
                  {data.keywords.map((k) => (
                    <tr key={k.keyword}>
                      <td className="cell-main">{k.keyword}</td>
                      <td className="r">{fmt.num(k.count)}</td>
                      <td className="r">%{fmt.num(k.density)}</td>
                      <td className="r"><Flag on={k.in_title} label="Title" /></td>
                      <td className="r"><Flag on={k.in_h1} label="H1" /></td>
                      <td className="r"><Flag on={k.in_headings} label="Alt başlıklar" /></td>
                      <td className="r"><Flag on={k.in_meta} label="Meta açıklama" /></td>
                      <td className="r"><Flag on={k.in_url} label="URL" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Taranan sayfaların sayfa içi SEO durumu (Search Console gerektirmez). */
export default function SitePages({ domain }) {
  const id = domain.id;
  const t = useTableState({ sort: 'onpage_score', order: 'asc' });
  const { setPage } = t;
  const [view, setView] = useState('all');
  const [selected, setSelected] = useState(null);
  useEffect(() => setPage(1), [view, setPage]);
  const params = { ...t.params, view };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['site', id, 'pages', params],
    queryFn: () => domainApi.sitePages(id, params),
    placeholderData: keepPreviousData,
  });

  if (data && !data.audit) return <NoAuditState domain={domain} />;

  return (
    <div className="card">
      <div className="toolbar">
        <div className="segmented">
          {VIEWS.map((v) => (
            <button key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="URL veya title ara…" value={t.search} onChange={(e) => t.setSearch(e.target.value)} maxLength={200} />
        </div>
        {isFetching && !isLoading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--text-3)' }} />}
      </div>
      <DataTable
        columns={columns} rows={data?.rows || []} loading={isLoading} sort={t.sort} order={t.order} onSort={t.onSort}
        rowKey={(r) => r.url} onRowClick={(r) => setSelected(r.url)}
        empty={<EmptyState icon={FileText} title="Bu filtrede sayfa yok" />}
      />
      {!!data?.total && <Pagination page={t.page} pageSize={params.pageSize} total={data.total} onPage={t.setPage} />}
      {selected && <PageDetailModal domainId={id} url={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
