import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { KeyRound, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { domainApi } from '../../../api/endpoints';
import { DataTable, Pagination } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Modal, Spinner } from '../../../components/ui/Feedback';
import { useTableState } from '../../../hooks/useTableState';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { Flag, NoAuditState, ScorePill } from './shared';

const VIEWS = [
  { key: 'targeted', label: 'Hedeflenen' },
  { key: 'all', label: 'Tümü' },
  { key: 'cannibal', label: 'Yamyamlık' },
  { key: 'template', label: 'Marka / şablon' },
];

const columns = [
  {
    key: 'keyword', label: 'Anahtar kelime', sortable: true,
    render: (r) => (
      <div style={{ minWidth: 0 }}>
        <div className="cell-main truncate" style={{ maxWidth: 320 }}>{r.keyword}</div>
        {r.best_url && <div className="cell-sub truncate" style={{ maxWidth: 320 }} title={r.best_url}>En güçlü: {shortUrl(r.best_url)}</div>}
      </div>
    ),
  },
  { key: 'score', label: 'Önem puanı', sortable: true, align: 'right', render: (r) => fmt.num(Math.round(r.score)) },
  { key: 'pages', label: 'Sayfa', sortable: true, align: 'right', render: (r) => fmt.num(r.pages) },
  { key: 'title_pages', label: 'Title’da', sortable: true, align: 'right', render: (r) => fmt.num(r.title_pages) },
  { key: 'h1', label: 'H1’de', align: 'right', render: (r) => fmt.num(r.h1_pages) },
  { key: 'occurrences', label: 'Geçiş', sortable: true, align: 'right', render: (r) => fmt.num(r.occurrences) },
  {
    key: 'status', label: 'Durum', align: 'right',
    render: (r) =>
      r.cannibal_pages > 1 ? <span className="badge badge-warning">{r.cannibal_pages} sayfa yarışıyor</span>
        : r.primary_pages ? <span className="badge badge-good">Ana kelime</span>
          : <span className="muted">—</span>,
  },
];

function KeywordPagesModal({ domainId, keyword, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['site', domainId, 'keyword-pages', keyword],
    queryFn: () => domainApi.siteKeywordPages(domainId, keyword),
  });
  return (
    <Modal title={`“${keyword}” geçen sayfalar`} onClose={onClose} width={860}>
      {isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Sayfa</th><th className="r">Geçiş</th><th className="r">Yoğunluk</th><th className="r">Title</th><th className="r">H1</th><th className="r">Meta</th><th className="r">URL</th><th className="r">Puan</th></tr>
            </thead>
            <tbody>
              {(data?.pages || []).map((p) => (
                <tr key={p.url}>
                  <td>
                    <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="cell-main truncate" style={{ maxWidth: 300, display: 'block' }} title={p.url}>{shortUrl(p.url)}</a>
                    <div className="cell-sub truncate" style={{ maxWidth: 300 }}>{p.is_primary ? 'Ana kelimesi · ' : ''}{p.title}</div>
                  </td>
                  <td className="r">{fmt.num(p.count)}</td>
                  <td className="r">%{fmt.num(p.density)}</td>
                  <td className="r"><Flag on={p.in_title} label="Title" /></td>
                  <td className="r"><Flag on={p.in_h1} label="H1" /></td>
                  <td className="r"><Flag on={p.in_meta} label="Meta açıklama" /></td>
                  <td className="r"><Flag on={p.in_url} label="URL" /></td>
                  <td className="r"><ScorePill score={p.onpage_score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Sitenin içeriğinden çıkarılan anahtar kelime profili (Search Console gerektirmez). */
export default function SiteKeywords({ domain }) {
  const id = domain.id;
  const t = useTableState({ sort: 'score' });
  const { setPage } = t;
  const [view, setView] = useState('targeted');
  const [selected, setSelected] = useState(null);
  useEffect(() => setPage(1), [view, setPage]);
  const params = { ...t.params, view };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['site', id, 'keywords', params],
    queryFn: () => domainApi.siteKeywords(id, params),
    placeholderData: keepPreviousData,
  });

  if (data && !data.audit) return <NoAuditState domain={domain} />;

  return (
    <div className="stack">
      <Alert type="info">
        Bu kelimeler sitenizin içeriğinden çıkarılır (title, H1, başlıklar, URL ve metin ağırlıklı) ve sayfalarınızın neyi hedeflediğini gösterir.
        {!domain.gsc_property && ' Google’daki gerçek sıralama ve gösterim verisi için Search Console bağlayabilirsiniz.'}
      </Alert>
      <div className="card">
        <div className="toolbar">
          <div className="segmented">
            {VIEWS.map((v) => (
              <button key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>{v.label}</button>
            ))}
          </div>
          <div className="input-icon">
            <Search size={16} />
            <input className="input input-sm" placeholder="Kelime ara…" value={t.search} onChange={(e) => t.setSearch(e.target.value)} maxLength={200} />
          </div>
          {isFetching && !isLoading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--text-3)' }} />}
        </div>
        <DataTable
          columns={columns} rows={data?.rows || []} loading={isLoading} sort={t.sort} order={t.order} onSort={t.onSort}
          rowKey={(r) => r.keyword} onRowClick={(r) => setSelected(r.keyword)}
          empty={<EmptyState icon={KeyRound} title={view === 'cannibal' ? 'Yamyamlık yok' : 'Kelime bulunamadı'} />}
        />
        {!!data?.total && <Pagination page={t.page} pageSize={params.pageSize} total={data.total} onPage={t.setPage} />}
      </div>
      {selected && <KeywordPagesModal domainId={id} keyword={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
