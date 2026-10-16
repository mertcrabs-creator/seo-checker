import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, Languages, Search, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import { rankingApi } from '../../../api/endpoints';
import { BUCKETS } from '../../../components/charts/PositionDistribution';
import { DataTable, Pagination, PositionPill } from '../../../components/ui/DataTable';
import { Alert, Delta, EmptyState, Modal, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { useTableState } from '../../../hooks/useTableState';
import { countryName, fmt, languageName, regionName, relativeChange, safeHref, shortUrl } from '../../../utils/format';

const COMMON_LANGUAGES = [
  'tr', 'en', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'ar', 'ru', 'az', 'kk', 'uz', 'pl', 'ro', 'el', 'sv', 'da', 'no', 'fi',
  'cs', 'hu', 'bg', 'uk', 'fa', 'he', 'ja', 'ko', 'zh', 'id', 'ms', 'vi', 'th', 'hi', 'ur', 'sr', 'hr', 'sq', 'ka',
];
const nameOf = (c) => (c.iso2 ? regionName(c.iso2, countryName(c.country)) : countryName(c.country));

function LanguagesModal({ domainId, current, detected, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [langs, setLangs] = useState(current);
  const save = useMutation({
    mutationFn: (v) => rankingApi.saveLanguages(domainId, v),
    onSuccess: () => {
      toast.success('Hedef diller kaydedildi');
      qc.invalidateQueries({ queryKey: ['rank', domainId] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      title="Hedef diller" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => save.mutate([])} disabled={save.isPending}>Otomatiğe döndür</button>
          <button className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={() => save.mutate(langs)} disabled={!langs.length || save.isPending}>
            {save.isPending ? <Spinner size={16} /> : 'Kaydet'}
          </button>
        </>
      }
    >
      <p className="text-2" style={{ fontSize: 13 }}>
        Seçili dillerin konuşulduğu ülkeler “hedef pazar” olarak öne çıkarılır.
        Otomatik tespit: {detected.length ? detected.map((d) => `${languageName(d.code)} (%${Math.round(d.share * 100)})`).join(', ') : 'tespit edilemedi'}.
      </p>
      <div className="row" style={{ gap: 6 }}>
        {COMMON_LANGUAGES.map((l) => {
          const on = langs.includes(l);
          return (
            <button
              key={l} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLangs(on ? langs.filter((x) => x !== l) : [...langs, l])} aria-pressed={on}
            >
              {languageName(l)}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function CountryKeywords({ domainId, country }) {
  const t = useTableState({ sort: 'impressions' });
  const { setPage } = t;
  const [bucket, setBucket] = useState('');
  useEffect(() => setPage(1), [bucket, country, setPage]);
  const params = { ...t.params, ...(bucket && { bucket }), country };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['rank', domainId, 'gsc', 'keywords', params],
    queryFn: () => rankingApi.gscKeywords(domainId, params),
    placeholderData: keepPreviousData,
  });
  const columns = useMemo(() => [
    {
      key: 'query', label: 'Anahtar kelime', sortable: true,
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div className="cell-main truncate" style={{ maxWidth: 320 }}>{r.query}</div>
          {r.page && <a href={safeHref(r.page)} target="_blank" rel="noopener noreferrer" className="cell-sub truncate" style={{ maxWidth: 320, display: 'block' }} title={r.page}>{shortUrl(r.page)}</a>}
        </div>
      ),
    },
    { key: 'position', label: 'Ort. sıra', sortable: true, align: 'right', render: (r) => <PositionPill value={r.position} /> },
    {
      key: 'change', label: 'Değişim', sortable: true, align: 'right',
      render: (r) => (r.prev_position === null ? <span className="badge badge-notice">Yeni</span> : <Delta value={r.change} mode="abs" />),
    },
    { key: 'clicks', label: 'Tıklama', sortable: true, align: 'right', render: (r) => fmt.num(r.clicks) },
    { key: 'impressions', label: 'Gösterim', sortable: true, align: 'right', render: (r) => fmt.num(r.impressions) },
    { key: 'ctr', label: 'TO', sortable: true, align: 'right', render: (r) => fmt.pct(r.ctr) },
  ], []);
  return (
    <>
      <div className="toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="Kelime ara…" value={t.search} onChange={(e) => t.setSearch(e.target.value)} maxLength={200} />
        </div>
        <select className="select select-sm" style={{ width: 150 }} value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="Pozisyon aralığı">
          <option value="">Tüm pozisyonlar</option>
          {BUCKETS.map((b) => <option key={b.key} value={b.key}>Sıra {b.label}</option>)}
        </select>
        {isFetching && !isLoading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--text-3)' }} />}
      </div>
      <DataTable
        columns={columns} rows={data?.rows || []} loading={isLoading} sort={t.sort} order={t.order} onSort={t.onSort}
        rowKey={(r) => r.query} empty={<EmptyState icon={Trophy} title="Bu filtrede kelime yok" />}
      />
      {!!data?.total && <Pagination page={t.page} pageSize={params.pageSize} total={data.total} onPage={t.setPage} />}
    </>
  );
}

function CountryMatrix({ domainId, scope }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [scope]);
  const params = { scope, page, pageSize: 50, ...(search.trim() && { search: search.trim() }) };
  const { data, isLoading } = useQuery({
    queryKey: ['rank', domainId, 'gsc', 'matrix', params],
    queryFn: () => rankingApi.gscMatrix(domainId, params),
    placeholderData: keepPreviousData,
  });
  const countries = data?.countries || [];
  return (
    <>
      <div className="toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="Kelime ara…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} maxLength={200} />
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>En çok gösterim alan 15 ülke · en çok ülkede görünen kelimeler önce</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Anahtar kelime</th><th className="r">En iyi</th><th className="r">Gösterim</th>
              {countries.map((c) => <th key={c.country} className="r" title={nameOf(c)}>{c.iso2 || c.country}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3 + countries.length}><Skeleton height={120} /></td></tr>
            ) : (data?.rows || []).map((r) => (
              <tr key={r.query}>
                <td><div className="cell-main truncate" style={{ maxWidth: 260 }}>{r.query}</div></td>
                <td className="r"><PositionPill value={r.best_position} /></td>
                <td className="r">{fmt.num(r.impressions)}</td>
                {countries.map((c) => <td key={c.country} className="r"><PositionPill value={r.positions[c.country] ?? null} /></td>)}
              </tr>
            ))}
            {!isLoading && !data?.rows?.length && <tr><td colSpan={3 + countries.length}><EmptyState icon={Trophy} title="Kayıt yok" /></td></tr>}
          </tbody>
        </table>
      </div>
      {!!data?.total && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
    </>
  );
}

function KeywordLookup({ domainId }) {
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['rank', domainId, 'gsc', 'lookup', keyword],
    queryFn: () => rankingApi.gscLookup(domainId, keyword),
    enabled: Boolean(keyword),
  });
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Kelime sıralaması (tüm ülkeler)</h3>
          <p>Bir kelimede sitenizin her ülkedeki ortalama Google sırası (son 28 gün, Search Console)</p>
        </div>
      </div>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setKeyword(input.trim()); }}>
        <div className="input-icon" style={{ flex: 1, maxWidth: 420 }}>
          <Search size={16} />
          <input className="input input-sm" placeholder="ör. saç ekimi" value={input} onChange={(e) => setInput(e.target.value)} maxLength={200} />
        </div>
        <button className="btn btn-primary btn-sm" type="submit" disabled={!input.trim()}>{isFetching ? <Spinner size={14} /> : 'Göster'}</button>
      </form>
      {isError && <div style={{ padding: '0 20px 16px' }}><Alert type="error">{errorMessage(error)}</Alert></div>}
      {data && (
        <div className="card-body grid grid-2" style={{ alignItems: 'start' }}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Ülke</th><th className="r">Ort. sıra</th><th className="r">Değişim</th><th className="r">Tıklama</th><th className="r">Gösterim</th></tr></thead>
              <tbody>
                {data.countries.map((c) => (
                  <tr key={c.country}>
                    <td>{nameOf(c)} {c.isTarget && <span className="badge badge-good" title="Site dilinin konuşulduğu ülke">Hedef</span>}</td>
                    <td className="r"><PositionPill value={c.position} /></td>
                    <td className="r">{c.prev_position === null ? <span className="badge badge-notice">Yeni</span> : <Delta value={c.prev_position - c.position} mode="abs" />}</td>
                    <td className="r">{fmt.num(c.clicks)}</td>
                    <td className="r">{fmt.num(c.impressions)}</td>
                  </tr>
                ))}
                {!data.countries.length && <tr><td colSpan={5} className="muted">Bu kelimede son 28 günde gösterim yok.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Benzer kelimeler</th><th className="r">Ülke</th><th className="r">Ort. sıra</th><th className="r">Gösterim</th></tr></thead>
              <tbody>
                {data.related.map((r) => (
                  <tr key={r.query} className="clickable" onClick={() => { setInput(r.query); setKeyword(r.query); }}>
                    <td className="cell-main truncate" style={{ maxWidth: 220 }}>{r.query}</td>
                    <td className="r">{fmt.num(r.countries)}</td>
                    <td className="r"><PositionPill value={r.position} /></td>
                    <td className="r">{fmt.num(r.impressions)}</td>
                  </tr>
                ))}
                {!data.related.length && <tr><td colSpan={4} className="muted">Benzer kelime yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Search Console'dan ücretsiz, gerçek Google verisiyle lokasyon bazlı sıralamalar. */
export default function GscRankings({ domain, onOpenSettings }) {
  const id = domain.id;
  const [scope, setScope] = useState('target');
  const [view, setView] = useState('country');
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['rank', id, 'gsc', 'summary', scope, domain.last_synced_at],
    queryFn: () => rankingApi.gscSummary(id, { scope }),
    enabled: Boolean(domain.gsc_property),
  });

  if (!domain.gsc_property) {
    return (
      <div className="card">
        <EmptyState
          icon={Globe2} title="Search Console mülkü seçilmedi"
          action={
            <div className="row">
              <Link to="/settings" className="btn btn-secondary">Google hesabını bağla</Link>
              {onOpenSettings && <button className="btn btn-primary" onClick={onOpenSettings}>Mülk seç</button>}
            </div>
          }
        >
          Ücretsiz lokasyon bazlı sıralamalar Google Search Console’dan gelir. Önce Ayarlar’dan Google hesabınızı bağlayın, ardından bu alan adı için mülkü seçin.
        </EmptyState>
      </div>
    );
  }
  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;

  const countries = data.countries;
  const current = countries.find((c) => c.country === selected) || countries[0];

  return (
    <div className="stack">
      <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h3 className="row" style={{ gap: 8, fontSize: 15 }}><Languages size={17} /> Hedef pazarlar</h3>
          <p className="text-2" style={{ fontSize: 13 }}>
            {data.languages.length
              ? <>{data.languages.map((l) => languageName(l)).join(', ')} konuşulan ülkeler{!data.languagesCustom && ' (site dilinden otomatik)'}</>
              : 'Sitenin dili tespit edilemedi; dil seçin veya tüm ülkeleri görüntüleyin.'}
          </p>
        </div>
        <div className="row">
          <div className="segmented" role="tablist" aria-label="Kapsam">
            <button className={scope === 'target' ? 'active' : ''} onClick={() => { setScope('target'); setSelected(null); }}>Hedef ülkeler</button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => { setScope('all'); setSelected(null); }}>Tüm ülkeler</button>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setModal(true)}><Languages size={15} /> Diller</button>
        </div>
      </div>

      {!countries.length ? (
        <div className="card">
          <EmptyState icon={Trophy} title={!data.synced ? 'İlk senkronizasyon bekleniyor' : 'Bu kapsamda sıralama verisi yok'}>
            {!data.synced
              ? 'Search Console verileri çekildiğinde ülke bazlı sıralamalar burada görünecek.'
              : scope === 'target'
                ? 'Hedef dildeki ülkelerde son 28 günde gösterim yok. “Tüm ülkeler”i deneyin veya dili değiştirin. Bu özellik eklenmeden önce senkronize edilen alan adlarında üstteki “Verileri güncelle” ile bir kez yeniden senkronize edin.'
                : 'Son 28 günde veri yok. Üstteki “Verileri güncelle” ile yeniden senkronize edin.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head"><div><h3>Ülkelere göre sıralamalar</h3><p>Son 28 gün · bir ülkeye tıklayarak kelimelerini görün</p></div></div>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr><th>Ülke</th><th className="r">Sıralanan kelime</th><th className="r">İlk 3</th><th className="r">İlk 10</th><th className="r">11–20</th><th className="r">Tıklama</th><th className="r">Gösterim</th><th className="r">Ort. sıra</th></tr>
                </thead>
                <tbody>
                  {countries.map((c) => (
                    <tr key={c.country} className="clickable" onClick={() => { setSelected(c.country); setView('country'); }}>
                      <td className="cell-main">
                        {nameOf(c)} {scope === 'all' && c.isTarget && <span className="badge badge-good">Hedef</span>}
                      </td>
                      <td className="r">{fmt.num(c.keywords)}</td>
                      <td className="r">{fmt.num(c.top3)}</td>
                      <td className="r">{fmt.num(c.top10)}</td>
                      <td className="r">{fmt.num(c.top20)}</td>
                      <td className="r">{fmt.num(c.clicks)} <Delta value={relativeChange(c.clicks, c.prev_clicks)} /></td>
                      <td className="r">{fmt.num(c.impressions)}</td>
                      <td className="r"><PositionPill value={c.position} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-head" style={{ paddingBottom: 14 }}>
              <div className="segmented">
                <button className={view === 'country' ? 'active' : ''} onClick={() => setView('country')}>Ülke detayı</button>
                <button className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>Ülke karşılaştırması</button>
              </div>
              {view === 'country' && current && (
                <select className="select select-sm" style={{ width: 240 }} value={current.country} onChange={(e) => setSelected(e.target.value)} aria-label="Ülke">
                  {countries.map((c) => <option key={c.country} value={c.country}>{nameOf(c)}</option>)}
                </select>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {view === 'country' && current ? <CountryKeywords domainId={id} country={current.country} /> : <CountryMatrix domainId={id} scope={scope} />}
            </div>
          </div>
        </>
      )}

      <KeywordLookup domainId={id} />
      {modal && <LanguagesModal domainId={id} current={data.languages} detected={data.detected} onClose={() => setModal(false)} />}
    </div>
  );
}
