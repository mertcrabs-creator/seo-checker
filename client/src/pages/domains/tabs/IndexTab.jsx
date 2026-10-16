import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, FileX2, Play, Search, Shuffle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { indexApi } from '../../../api/endpoints';
import { DataTable, Pagination } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, safeHref, shortUrl } from '../../../utils/format';

const VIEWS = [
  { key: 'all', label: 'Tümü' }, { key: 'not_indexed', label: 'İndekslenmemiş' }, { key: 'indexed', label: 'İndeksli' },
  { key: 'canonical', label: 'Canonical farklı' }, { key: 'errors', label: 'Hata' },
];
const VERDICT = { PASS: ['badge-good', 'İndeksli'], NEUTRAL: ['badge-warning', 'Hariç'], FAIL: ['badge-critical', 'Sorunlu'], PARTIAL: ['badge-warning', 'Kısmi'] };

/** Google'ın sık verdiği indekslenmeme nedenleri için yapılacaklar (Search Console Türkçe metinleriyle eşleşir). */
const FIXES = [
  [/taranmış.*dizine eklenmemiş|crawled.*not indexed/i, 'Google sayfayı gördü ama değersiz buldu. İçeriği zenginleştirin, benzer sayfalarla birleştirin ve önemli sayfalardan iç bağlantı verin.'],
  [/keşfedildi.*dizine eklenmemiş|discovered.*not indexed/i, 'Google henüz taramadı (tarama bütçesi). Site haritasına ekleyin, iç bağlantı verin, sunucu hızını iyileştirin.'],
  [/standart|canonical/i, 'Google başka bir URL’yi asıl sayfa seçti. Canonical etiketini, kopya içeriği ve iç bağlantıları kontrol edin.'],
  [/noindex/i, 'Sayfada noindex var. İndekslenmesi gerekiyorsa meta robots / X-Robots-Tag etiketini kaldırın.'],
  [/robots\.txt/i, 'robots.txt engelliyor. İlgili Disallow kuralını kaldırın.'],
  [/yönlendirme|redirect/i, 'Sayfa yönlendiriyor. İç bağlantıları ve site haritasını hedef URL ile güncelleyin.'],
  [/404|bulunamadı|not found/i, 'Sayfa bulunamıyor. Geri getirin veya ilgili sayfaya 301 verin.'],
  [/bilinmiyor|unknown/i, 'Google bu URL’yi hiç görmemiş. Site haritasına ekleyin ve iç bağlantı verin.'],
];
const fixFor = (state) => FIXES.find(([re]) => re.test(state || ''))?.[1] || null;

export default function IndexTab({ domain }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [view, search]);

  const summary = useQuery({
    queryKey: ['index', id, 'summary'],
    queryFn: () => indexApi.summary(id),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 4000 : false),
  });
  const running = summary.data?.status === 'running';
  const params = { view, page, pageSize: 50, ...(search.trim() && { search: search.trim() }) };
  const list = useQuery({
    queryKey: ['index', id, 'pages', params, summary.data?.updatedAt],
    queryFn: () => indexApi.pages(id, params),
    placeholderData: keepPreviousData,
    refetchInterval: running ? 5000 : false,
  });
  const run = useMutation({
    mutationFn: () => indexApi.inspect(id),
    onSuccess: () => {
      toast.success('İndeks denetimi başladı');
      qc.invalidateQueries({ queryKey: ['index', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!domain.gsc_property) {
    return <div className="card"><EmptyState icon={FileCheck2} title="Search Console mülkü gerekli">İndekslenme durumu Google Search Console URL Denetimi API’sinden gelir.</EmptyState></div>;
  }
  if (summary.isLoading) return <Skeleton height={300} />;
  if (summary.isError) return <Alert type="error">{errorMessage(summary.error)}</Alert>;
  const s = summary.data;
  const t = s.totals;

  const columns = [
    {
      key: 'url', label: 'Sayfa',
      render: (r) => <a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" className="cell-main truncate" style={{ display: 'block', maxWidth: 340 }} title={r.url}>{shortUrl(r.url)}</a>,
    },
    {
      key: 'verdict', label: 'Durum',
      render: (r) => (r.error ? <span className="badge badge-critical" title={r.error}>Hata</span> : <span className={`badge ${VERDICT[r.verdict]?.[0] || 'badge-neutral'}`}>{VERDICT[r.verdict]?.[1] || r.verdict || '—'}</span>),
    },
    {
      key: 'coverage', label: 'Google’ın açıklaması',
      render: (r) => {
        const fix = r.verdict !== 'PASS' ? fixFor(r.coverage_state) : null;
        return (
          <div style={{ minWidth: 0, maxWidth: 380 }}>
            <div>{r.coverage_state || r.error || '—'}</div>
            {fix && <div className="cell-sub" style={{ whiteSpace: 'normal' }}>{fix}</div>}
            {r.google_canonical && r.user_canonical && r.google_canonical !== r.user_canonical && (
              <div className="cell-sub truncate" title={r.google_canonical}>Google’ın seçtiği: {shortUrl(r.google_canonical)}</div>
            )}
          </div>
        );
      },
    },
    { key: 'crawled', label: 'Tarayan', render: (r) => (r.crawled_as ? (r.crawled_as === 'MOBILE' ? 'Mobil' : 'Masaüstü') : '—') },
    { key: 'last_crawl', label: 'Son Google taraması', align: 'right', render: (r) => <span className="muted">{r.last_crawl ? fmt.dateTime(r.last_crawl) : '—'}</span> },
  ];

  return (
    <div className="stack">
      <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h3 style={{ fontSize: 15 }}>Google indekslenme durumu</h3>
          <p className="text-2" style={{ fontSize: 13 }}>
            Son taramadaki sayfalar Google URL Denetimi ile tek tek kontrol edilir (tur başına {s.limit} sayfa, haftalık otomatik).
            {s.updatedAt && <span className="muted"> · Son denetim {fmt.dateTime(s.updatedAt)}</span>}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => run.mutate()} disabled={running || run.isPending}>
          {running ? <><Spinner size={14} /> Denetleniyor…</> : <><Play size={15} /> Denetle</>}
        </button>
      </div>
      {s.error && <Alert type="error">{s.error}</Alert>}

      {!t.inspected ? (
        <div className="card"><EmptyState icon={FileCheck2} title={running ? 'Sayfalar denetleniyor' : 'Henüz denetim yapılmadı'}>“Denetle” ile sayfalarınızın Google’da indeksli olup olmadığını ve nedenini görün.</EmptyState></div>
      ) : (
        <>
          <div className="grid grid-4">
            {[
              [FileCheck2, 'İndeksli', t.indexed, `${fmt.num(t.inspected)} sayfa denetlendi`],
              [FileX2, 'İndekslenmemiş', t.not_indexed, 'Nedenleri aşağıda'],
              [Shuffle, 'Canonical farklı', t.canonical_mismatch, 'Google başka URL seçti'],
              [Search, 'Denetim hatası', t.errors, 'Mülk dışı veya kota'],
            ].map(([Icon, label, value, foot]) => (
              <div key={label} className="card stat">
                <span className="stat-label"><span className="stat-icon"><Icon size={16} /></span>{label}</span>
                <span className="stat-value num">{fmt.num(value)}</span>
                <span className="stat-foot">{foot}</span>
              </div>
            ))}
          </div>
          <div className="card card-pad" style={{ display: 'grid', gap: 8 }}>
            <h3 style={{ fontSize: 15 }}>Google’ın durum açıklamaları</h3>
            {s.states.map((x) => (
              <div key={x.state} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="text-2">{x.state}</span><strong className="num">{fmt.num(x.pages)}</strong>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="toolbar">
              <div className="segmented">
                {VIEWS.map((v) => <button key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>{v.label}</button>)}
              </div>
              <div className="input-icon">
                <Search size={16} />
                <input className="input input-sm" placeholder="URL ara…" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={200} />
              </div>
            </div>
            <DataTable columns={columns} rows={list.data?.rows || []} loading={list.isLoading} rowKey={(r) => r.url} empty={<EmptyState icon={FileCheck2} title="Bu filtrede sayfa yok" />} />
            {!!list.data?.total && <Pagination page={page} pageSize={50} total={list.data.total} onPage={setPage} />}
          </div>
        </>
      )}
    </div>
  );
}
