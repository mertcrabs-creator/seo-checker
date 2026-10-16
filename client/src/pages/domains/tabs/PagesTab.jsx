import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { domainApi } from '../../../api/endpoints';
import { DataTable, Pagination, PositionPill } from '../../../components/ui/DataTable';
import { Delta, EmptyState } from '../../../components/ui/Feedback';
import { useTableState } from '../../../hooks/useTableState';
import { fmt, relativeChange, safeHref, shortUrl } from '../../../utils/format';

const columns = [
  {
    key: 'page', label: 'Sayfa', sortable: true,
    render: (r) => (
      <div className="cell-main truncate">
        <a href={safeHref(r.key)} target="_blank" rel="noopener noreferrer" title={r.key}>{shortUrl(r.key)}</a>
      </div>
    ),
  },
  { key: 'clicks', label: 'Tıklama', sortable: true, align: 'right', render: (r) => fmt.num(r.clicks) },
  {
    key: 'prev', label: 'Tıklama değişimi', align: 'right',
    render: (r) => (r.prev_clicks === null ? <span className="badge badge-notice">Yeni</span> : <Delta value={relativeChange(r.clicks, r.prev_clicks)} />),
  },
  { key: 'impressions', label: 'Gösterim', sortable: true, align: 'right', render: (r) => fmt.num(r.impressions) },
  { key: 'ctr', label: 'TO', sortable: true, align: 'right', render: (r) => fmt.pct(r.ctr) },
  { key: 'position', label: 'Ort. poz.', sortable: true, align: 'right', render: (r) => <PositionPill value={r.position} /> },
];

export default function PagesTab({ domain, days }) {
  const t = useTableState();
  const params = { ...t.params, days };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['gsc', domain.id, 'pages', params],
    queryFn: () => domainApi.pages(domain.id, params),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="card">
      <div className="toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="URL içinde ara…" value={t.search} onChange={(e) => t.setSearch(e.target.value)} maxLength={200} />
        </div>
        {isFetching && !isLoading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--text-3)' }} />}
      </div>
      <DataTable
        columns={columns} rows={data?.rows || []} loading={isLoading} sort={t.sort} order={t.order} onSort={t.onSort}
        rowKey={(r) => r.key} empty={<EmptyState icon={FileText} title="Sayfa bulunamadı" />}
      />
      {!!data?.total && <Pagination page={t.page} pageSize={params.pageSize} total={data.total} onPage={t.setPage} />}
    </div>
  );
}
