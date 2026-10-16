import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { KeyRound, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../api/client';
import { useTableState } from '../hooks/useTableState';
import { fmt, safeHref, shortUrl } from '../utils/format';
import { BUCKETS } from './charts/PositionDistribution';
import { DataTable, Pagination, PositionPill } from './ui/DataTable';
import { Alert, Delta, EmptyState } from './ui/Feedback';

/**
 * Paylaşılan anahtar kelime tablosu (alan adı sekmesi + global sayfa).
 * `fetcher(params)` ve `queryKey` dışarıdan verilir; filtre/sıralama/sayfalama sunucuda.
 */
/** Bu gösterimin altında ortalama pozisyon güvenilir değildir */
export const LOW_DATA = 20;

export default function KeywordTable({ queryKey, fetcher, days, country, showDomain, bucket, onBucket, onRowClick, extraFilters }) {
  const t = useTableState();
  const { setPage } = t;
  // Kova dışarıdan (grafik tıklaması / select) kontrol edilir
  // Varsayılan: sadece güvenilir (en az 20 gösterim) kelimeler; az gösterimde ortalama pozisyon yanıltıcıdır
  const [minImpressions, setMinImpressions] = useState(LOW_DATA);
  const [brand, setBrand] = useState('all');
  useEffect(() => setPage(1), [bucket, days, country, minImpressions, brand, setPage]);
  const params = {
    ...t.params, days, ...(bucket && { bucket }), ...(country && { country }),
    ...(minImpressions && { minImpressions }), ...(brand !== 'all' && { brand }),
  };

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: [...queryKey, params],
    queryFn: () => fetcher(params),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(
    () => [
      {
        key: 'query', label: 'Anahtar kelime', sortable: true,
        render: (r) => (
          <div>
            <div className="cell-main truncate">
              {r.key} {r.is_brand && <span className="badge badge-neutral" title="Marka araması: alan adınızı içeren sorgu">Marka</span>}
            </div>
            <div className="cell-sub truncate">
              {showDomain && <span>{r.hostname} · </span>}
              {r.url ? <a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={r.url}>{shortUrl(r.url)}</a> : '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'position', label: 'Pozisyon', sortable: true, align: 'right',
        render: (r) => (
          <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            {r.impressions < LOW_DATA && <span className="badge badge-warning" title="Bu dönemde 20’den az gösterim: ortalama pozisyon gerçek sırayı yansıtmayabilir">az veri</span>}
            <PositionPill value={r.position} />
          </span>
        ),
      },
      {
        key: 'change', label: 'Değişim', sortable: true, align: 'right',
        render: (r) => (r.prev_position === null ? <span className="badge badge-notice">Yeni</span> : <Delta value={r.change} mode="abs" />),
      },
      { key: 'clicks', label: 'Tıklama', sortable: true, align: 'right', render: (r) => fmt.num(r.clicks) },
      { key: 'impressions', label: 'Gösterim', sortable: true, align: 'right', render: (r) => fmt.num(r.impressions) },
      { key: 'ctr', label: 'TO', sortable: true, align: 'right', render: (r) => fmt.pct(r.ctr) },
    ],
    [showDomain],
  );

  return (
    <div className="card">
      <div className="toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="Anahtar kelime ara…" value={t.search} onChange={(e) => t.setSearch(e.target.value)} maxLength={200} />
        </div>
        {extraFilters}
        <select className="select select-sm" style={{ width: 190 }} value={minImpressions} onChange={(e) => setMinImpressions(Number(e.target.value))} aria-label="Güvenilirlik">
          <option value={LOW_DATA}>Güvenilir (20+ gösterim)</option>
          <option value={100}>Çok güvenilir (100+ gösterim)</option>
          <option value={0}>Tümü (az veri dahil)</option>
        </select>
        <select className="select select-sm" style={{ width: 150 }} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marka aramaları">
          <option value="all">Marka dahil</option>
          <option value="exclude">Marka hariç</option>
          <option value="only">Sadece marka</option>
        </select>
        <select className="select select-sm" style={{ width: 170 }} value={bucket || ''} onChange={(e) => onBucket(e.target.value)} aria-label="Pozisyon aralığı">
          <option value="">Tüm pozisyonlar</option>
          {BUCKETS.map((b) => <option key={b.key} value={b.key}>Pozisyon {b.label}</option>)}
        </select>
        {isFetching && !isLoading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--text-3)' }} />}
      </div>
      {isError && <div style={{ padding: 16 }}><Alert type="error">{errorMessage(error)}</Alert></div>}
      <DataTable
        columns={columns}
        rows={data?.rows || []}
        loading={isLoading}
        sort={t.sort}
        order={t.order}
        onSort={t.onSort}
        onRowClick={onRowClick}
        rowKey={(r) => `${r.domain_id}|${r.key}`}
        empty={<EmptyState icon={KeyRound} title="Anahtar kelime bulunamadı">Filtreleri değiştirmeyi veya tarih aralığını genişletmeyi deneyin.</EmptyState>}
      />
      {!!data?.total && <Pagination page={t.page} pageSize={params.pageSize} total={data.total} onPage={t.setPage} />}
    </div>
  );
}
