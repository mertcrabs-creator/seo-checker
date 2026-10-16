import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, Languages, RefreshCw, Search, Settings2, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { rankingApi } from '../../../api/endpoints';
import { BUCKETS } from '../../../components/charts/PositionDistribution';
import { DataTable, Pagination, PositionPill } from '../../../components/ui/DataTable';
import { Alert, Delta, EmptyState, Modal, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { useTableState } from '../../../hooks/useTableState';
import { fmt, languageName, regionName, safeHref, shortUrl } from '../../../utils/format';
import GscRankings from './GscRankings';

const INTENT = { informational: 'Bilgi', navigational: 'Navigasyon', commercial: 'Ticari', transactional: 'İşlem' };
const locKey = (l) => `${l.location_code ?? l.locationCode}:${l.language_code ?? l.languageCode}`;
const countryOf = (l) => regionName(l.country_iso ?? l.countryIso, l.location_name ?? l.locationName);

function SetupState() {
  return (
    <div className="card">
      <EmptyState icon={Globe2} title="Lokasyon bazlı sıralamalar için veri sağlayıcı gerekli">
        Bir sitenin hangi ülkede hangi kelimede kaçıncı sırada olduğu yalnızca Google sonuçlarından öğrenilebilir. Bu veriyi
        DataForSEO sağlar (kullandıkça öde). <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer">API bilgilerinizi</a> alıp
        sunucudaki <code>.env</code> dosyasına <code>DATAFORSEO_LOGIN</code> ve <code>DATAFORSEO_PASSWORD</code> olarak ekleyin, ardından sunucuyu yeniden başlatın.
      </EmptyState>
    </div>
  );
}

/** Dil ve ülke seçimi: varsayılan olarak site dili ve o dilin desteklendiği tüm ülkeler. */
function TargetSettingsModal({ domainId, cfg, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [languages, setLanguages] = useState(cfg.languages);
  const [addLang, setAddLang] = useState('');
  const [selected, setSelected] = useState(() => new Set(cfg.candidates.filter((c) => c.selected).map((c) => c.locationCode)));
  const [langTouched, setLangTouched] = useState(false);

  const save = useMutation({
    mutationFn: (body) => rankingApi.saveConfig(domainId, body),
    onSuccess: () => {
      toast.success('Hedef pazarlar kaydedildi');
      qc.invalidateQueries({ queryKey: ['rank', domainId, 'config'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Dil değiştiyse ülke listesi sunucuda yeniden hesaplanır; seçim "tümü" olarak sıfırlanır
  const visible = langTouched ? [] : cfg.candidates;
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.locationCode));
  const detectedCodes = cfg.detected.map((d) => d.code);

  const submit = () => {
    const sameAsAuto = !langTouched && allSelected;
    save.mutate({
      languages: langTouched || cfg.languagesCustom ? languages : [],
      locations: langTouched || sameAsAuto ? [] : [...selected],
    });
  };

  return (
    <Modal
      title="Hedef diller ve ülkeler" onClose={onClose} width={760}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => save.mutate({ languages: [], locations: [] })} disabled={save.isPending}>Otomatiğe döndür</button>
          <button className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={submit} disabled={!languages.length || save.isPending}>{save.isPending ? <Spinner size={16} /> : 'Kaydet'}</button>
        </>
      }
    >
      <div className="field">
        <label>Diller</label>
        <div className="row" style={{ gap: 6 }}>
          {languages.map((l) => (
            <button
              key={l} className="badge badge-notice" style={{ cursor: 'pointer', border: 0 }} title="Kaldır"
              onClick={() => { setLanguages(languages.filter((x) => x !== l)); setLangTouched(true); }}
            >
              {languageName(l)} ({l}) ✕
            </button>
          ))}
          <select
            className="select select-sm" style={{ width: 200 }} value={addLang} aria-label="Dil ekle"
            onChange={(e) => {
              const v = e.target.value;
              if (v && !languages.includes(v)) { setLanguages([...languages, v]); setLangTouched(true); }
              setAddLang('');
            }}
          >
            <option value="">+ Dil ekle</option>
            {cfg.availableLanguages.map((l) => <option key={l.code} value={l.code}>{languageName(l.code, l.name)} ({l.code})</option>)}
          </select>
        </div>
        <span className="hint">Site dili otomatik tespit edildi: {detectedCodes.length ? detectedCodes.map((c) => languageName(c)).join(', ') : 'tespit edilemedi'}.</span>
      </div>

      {langTouched ? (
        <Alert type="info">Dil değişikliği kaydedildiğinde seçili dillerin desteklendiği tüm ülkeler hedeflenir; ardından ülkeleri tekrar daraltabilirsiniz.</Alert>
      ) : (
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label>Ülkeler ({selected.size}/{visible.length})</label>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(allSelected ? new Set() : new Set(visible.map((c) => c.locationCode)))}>
              {allSelected ? 'Hiçbirini seçme' : 'Tümünü seç'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {visible.map((c) => (
              <label key={locKey(c)} className="row" style={{ gap: 8, flexWrap: 'nowrap', cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox" checked={selected.has(c.locationCode)}
                  onChange={() => {
                    const next = new Set(selected);
                    next.has(c.locationCode) ? next.delete(c.locationCode) : next.add(c.locationCode);
                    setSelected(next);
                  }}
                />
                <span className="truncate">{countryOf(c)} <span className="muted">· {c.languageCode}</span></span>
              </label>
            ))}
          </div>
          {selected.size > cfg.maxLocations && <span className="field-error">Bir güncellemede en fazla {cfg.maxLocations} ülke sorgulanır.</span>}
        </div>
      )}
    </Modal>
  );
}

function CountryKeywords({ domainId, location }) {
  const t = useTableState({ sort: 'etv' });
  const { setPage } = t;
  const [bucket, setBucket] = useState('');
  useEffect(() => setPage(1), [bucket, location, setPage]);
  const params = { ...t.params, ...(bucket && { bucket }), location: location.location_code, language: location.language_code };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['rank', domainId, 'keywords', params],
    queryFn: () => rankingApi.keywords(domainId, params),
    placeholderData: keepPreviousData,
  });
  const columns = useMemo(() => [
    {
      key: 'keyword', label: 'Anahtar kelime', sortable: true,
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div className="cell-main truncate" style={{ maxWidth: 300 }}>{r.keyword}</div>
          {r.url && <a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" className="cell-sub truncate" style={{ maxWidth: 300, display: 'block' }} title={r.url}>{shortUrl(r.url)}</a>}
        </div>
      ),
    },
    { key: 'position', label: 'Sıra', sortable: true, align: 'right', render: (r) => <PositionPill value={r.position} /> },
    {
      key: 'change', label: 'Değişim', sortable: true, align: 'right',
      render: (r) => (r.is_new || r.previous_position === null ? <span className="badge badge-notice">Yeni</span> : <Delta value={r.change} mode="abs" />),
    },
    { key: 'search_volume', label: 'Aylık arama', sortable: true, align: 'right', render: (r) => fmt.num(r.search_volume) },
    { key: 'etv', label: 'Tahmini trafik', sortable: true, align: 'right', render: (r) => fmt.num(r.etv) },
    { key: 'difficulty', label: 'Zorluk', sortable: true, align: 'right', render: (r) => (r.difficulty ?? '—') },
    { key: 'cpc', label: 'TBM', sortable: true, align: 'right', render: (r) => (r.cpc === null ? '—' : `$${r.cpc.toFixed(2)}`) },
    { key: 'intent', label: 'Niyet', render: (r) => (r.intent ? <span className="badge badge-neutral">{INTENT[r.intent] || r.intent}</span> : '—') },
  ], []);

  return (
    <>
      <div className="toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="Kelime veya URL ara…" value={t.search} onChange={(e) => t.setSearch(e.target.value)} maxLength={200} />
        </div>
        <select className="select select-sm" style={{ width: 150 }} value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="Pozisyon aralığı">
          <option value="">Tüm pozisyonlar</option>
          {BUCKETS.map((b) => <option key={b.key} value={b.key}>Sıra {b.label}</option>)}
        </select>
        {isFetching && !isLoading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--text-3)' }} />}
      </div>
      <DataTable
        columns={columns} rows={data?.rows || []} loading={isLoading} sort={t.sort} order={t.order} onSort={t.onSort}
        rowKey={(r) => r.keyword} empty={<EmptyState icon={Trophy} title="Bu filtrede kelime yok" />}
      />
      {!!data?.total && <Pagination page={t.page} pageSize={params.pageSize} total={data.total} onPage={t.setPage} />}
    </>
  );
}

function CountryMatrix({ domainId }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 50, ...(search.trim() && { search: search.trim() }) };
  const { data, isLoading } = useQuery({
    queryKey: ['rank', domainId, 'matrix', params],
    queryFn: () => rankingApi.matrix(domainId, params),
    placeholderData: keepPreviousData,
  });
  const locations = data?.locations || [];
  return (
    <>
      <div className="toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="Kelime ara…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} maxLength={200} />
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>En çok ülkede sıralanan kelimeler önce</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Anahtar kelime</th><th className="r">En iyi</th><th className="r">Maks. arama</th>
              {locations.map((l) => <th key={locKey(l)} className="r" title={`${countryOf(l)} · ${l.language_code}`}>{l.country_iso || l.location_code}{locations.filter((x) => x.location_code === l.location_code).length > 1 ? `·${l.language_code}` : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3 + locations.length}><Skeleton height={120} /></td></tr>
            ) : (data?.rows || []).map((r) => (
              <tr key={r.keyword}>
                <td><div className="cell-main truncate" style={{ maxWidth: 260 }}>{r.keyword}</div></td>
                <td className="r"><PositionPill value={r.best_position} /></td>
                <td className="r">{fmt.num(r.max_volume)}</td>
                {locations.map((l) => <td key={locKey(l)} className="r"><PositionPill value={r.positions[locKey(l)] ?? null} /></td>)}
              </tr>
            ))}
            {!isLoading && !data?.rows?.length && <tr><td colSpan={3 + locations.length}><EmptyState icon={Trophy} title="Kayıt yok" /></td></tr>}
          </tbody>
        </table>
      </div>
      {!!data?.total && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
    </>
  );
}

function KeywordCheck({ domainId, cfg }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [keyword, setKeyword] = useState('');
  const checks = useQuery({
    queryKey: ['rank', domainId, 'checks'],
    queryFn: () => rankingApi.checks(domainId),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const run = useMutation({
    mutationFn: () => rankingApi.check(domainId, keyword.trim()),
    onSuccess: (r) => {
      toast.success(`"${r.keyword}" ${r.locations} ülkede kontrol ediliyor`);
      qc.invalidateQueries({ queryKey: ['rank', domainId, 'checks'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const running = checks.data?.running || run.isPending;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Kelime sıralama kontrolü</h3>
          <p>Bir kelimede sitenizin her hedef ülkedeki canlı Google sırası (ilk {cfg.checkDepth} sonuç)</p>
        </div>
      </div>
      <form
        className="toolbar" onSubmit={(e) => { e.preventDefault(); if (keyword.trim() && !running) run.mutate(); }}
      >
        <div className="input-icon" style={{ flex: 1, maxWidth: 420 }}>
          <Search size={16} />
          <input className="input input-sm" placeholder="ör. red dress" value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={200} />
        </div>
        <button className="btn btn-primary btn-sm" type="submit" disabled={!keyword.trim() || running}>
          {running ? <><Spinner size={14} /> Kontrol ediliyor…</> : 'Kontrol et'}
        </button>
      </form>
      <div className="card-body" style={{ display: 'grid', gap: 16 }}>
        {(checks.data?.checks || []).slice(0, 5).map((c) => (
          <div key={`${c.keyword}-${c.checked_at}`}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>{c.keyword}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{fmt.dateTime(c.checked_at)}</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Ülke</th><th className="r">Sıra</th><th>Sıralanan sayfa</th></tr></thead>
                <tbody>
                  {c.results.map((r) => (
                    <tr key={locKey(r)}>
                      <td>{countryOf(r)} <span className="muted">· {r.languageCode}</span></td>
                      <td className="r">{r.error ? <span className="badge badge-critical" title={r.error}>Hata</span> : r.position ? <PositionPill value={r.position} /> : <span className="muted">İlk {cfg.checkDepth}’de yok</span>}</td>
                      <td className="truncate" style={{ maxWidth: 320 }}>{r.url ? <a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" title={r.url}>{shortUrl(r.url)}</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {!checks.data?.checks?.length && !running && <p className="muted">Henüz kelime kontrolü yapılmadı.</p>}
      </div>
    </div>
  );
}

/** DataForSEO: sitenin dilinin konuşulduğu tüm ülkelerde Google sıralamaları (ücretli, opsiyonel). */
export function DataForSeoRankings({ domain }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [view, setView] = useState('country');
  const [selectedKey, setSelectedKey] = useState(null);

  const cfg = useQuery({
    queryKey: ['rank', id, 'config'],
    queryFn: () => rankingApi.config(id),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 4000 : false),
  });
  const running = cfg.data?.status === 'running';
  const summary = useQuery({
    queryKey: ['rank', id, 'summary'],
    queryFn: () => rankingApi.summary(id),
    enabled: Boolean(cfg.data?.enabled),
    refetchInterval: running ? 5000 : false,
  });

  // Güncelleme bitince tüm sıralama verilerini tazele
  const [prevRunning, setPrevRunning] = useState(false);
  if (running !== prevRunning) {
    if (prevRunning && !running) qc.invalidateQueries({ queryKey: ['rank', id] });
    setPrevRunning(running);
  }

  const refresh = useMutation({
    mutationFn: () => rankingApi.refresh(id),
    onSuccess: (r) => {
      toast.success(`${r.locations} ülkede sıralamalar güncelleniyor`);
      qc.invalidateQueries({ queryKey: ['rank', id, 'config'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (cfg.isLoading) return <Skeleton height={320} />;
  if (cfg.isError) return <Alert type="error">{errorMessage(cfg.error)}</Alert>;
  if (!cfg.data.enabled) return <SetupState />;

  const c = cfg.data;
  const selectedCount = c.candidates.filter((x) => x.selected).length;
  const locations = summary.data?.locations || [];
  const current = locations.find((l) => locKey(l) === selectedKey) || locations[0];

  return (
    <div className="stack">
      <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h3 className="row" style={{ gap: 8, fontSize: 15 }}><Languages size={17} /> Hedef pazarlar</h3>
          <p className="text-2" style={{ fontSize: 13 }}>
            {c.languages.length
              ? <>{c.languages.map((l) => languageName(l)).join(', ')} · <strong>{selectedCount}</strong> ülke{!c.languagesCustom && ' (site dilinden otomatik)'}</>
              : 'Sitenin dili tespit edilemedi. Ayarlardan dil seçin.'}
            {c.updatedAt && <span className="muted"> · Son güncelleme {fmt.dateTime(c.updatedAt)}</span>}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={() => setModal(true)} disabled={running}><Settings2 size={15} /> Diller & ülkeler</button>
          <button className="btn btn-primary btn-sm" onClick={() => refresh.mutate()} disabled={running || refresh.isPending || !selectedCount}>
            <RefreshCw size={15} className={running ? 'spin' : ''} /> {running ? 'Güncelleniyor…' : `Sıralamaları güncelle (${Math.min(selectedCount, c.maxLocations)} ülke)`}
          </button>
        </div>
      </div>

      {c.status === 'failed' && c.error && <Alert type="error">Son güncelleme başarısız: {c.error}</Alert>}
      {c.status !== 'failed' && c.error && <Alert type="warning">{c.error}</Alert>}

      {!locations.length ? (
        <div className="card">
          <EmptyState icon={Trophy} title={running ? 'Sıralamalar çekiliyor' : 'Henüz sıralama verisi yok'}>
            {running
              ? 'Her ülke için sitenizin Google’da sıralandığı kelimeler toplanıyor. Bu işlem birkaç dakika sürebilir.'
              : '“Sıralamaları güncelle” ile sitenizin seçili ülkelerdeki tüm Google sıralamalarını, aranma hacimlerini ve tahmini trafiğini çekin.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head"><div><h3>Ülkelere göre görünürlük</h3><p>Bir ülkeye tıklayarak kelimelerini görün</p></div></div>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr><th>Ülke</th><th>Dil</th><th className="r">Sıralanan kelime</th><th className="r">İlk 3</th><th className="r">İlk 10</th><th className="r">11–20</th><th className="r">Tahmini trafik</th><th className="r">Güncelleme</th></tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={locKey(l)} className={`clickable ${current && locKey(current) === locKey(l) ? 'active' : ''}`} onClick={() => { setSelectedKey(locKey(l)); setView('country'); }}>
                      <td className="cell-main">{countryOf(l)}</td>
                      <td>{languageName(l.language_code)}</td>
                      <td className="r">
                        {fmt.num(l.total_count)}{' '}
                        {l.prev_total !== null && <Delta value={l.prev_total ? (l.total_count - l.prev_total) / l.prev_total : null} />}
                      </td>
                      <td className="r">{fmt.num(l.top3)}</td>
                      <td className="r">{fmt.num(l.top10)}</td>
                      <td className="r">{fmt.num(l.top20)}</td>
                      <td className="r">{fmt.num(l.etv === null ? null : Math.round(l.etv))}</td>
                      <td className="r muted">{fmt.dateTime(l.finished_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!summary.data?.failed?.length && (
              <p className="hint" style={{ padding: '10px 20px' }}>
                Son 24 saatte başarısız: {summary.data.failed.map((f) => `${f.location_name} (${f.error})`).join(', ')}
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-head" style={{ paddingBottom: 14 }}>
              <div className="segmented">
                <button className={view === 'country' ? 'active' : ''} onClick={() => setView('country')}>Ülke detayı</button>
                <button className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>Ülke karşılaştırması</button>
              </div>
              {view === 'country' && current && (
                <select className="select select-sm" style={{ width: 240 }} value={locKey(current)} onChange={(e) => setSelectedKey(e.target.value)} aria-label="Ülke">
                  {locations.map((l) => <option key={locKey(l)} value={locKey(l)}>{countryOf(l)} · {l.language_code}</option>)}
                </select>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {view === 'country' && current ? <CountryKeywords domainId={id} location={current} /> : <CountryMatrix domainId={id} />}
            </div>
          </div>
        </>
      )}

      <KeywordCheck domainId={id} cfg={c} />
      {modal && <TargetSettingsModal domainId={id} cfg={c} onClose={() => setModal(false)} />}
    </div>
  );
}

/** Sıralamalar: Search Console (ücretsiz, varsayılan) veya DataForSEO (ücretli, opsiyonel). */
export default function RankingsTab({ domain, onOpenSettings }) {
  const [source, setSource] = useState('gsc');
  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="Sıralama kaynağı" style={{ justifySelf: 'start' }}>
        <button className={source === 'gsc' ? 'active' : ''} onClick={() => setSource('gsc')} role="tab" aria-selected={source === 'gsc'}>
          Search Console (ücretsiz)
        </button>
        <button className={source === 'dfs' ? 'active' : ''} onClick={() => setSource('dfs')} role="tab" aria-selected={source === 'dfs'}>
          DataForSEO (ücretli)
        </button>
      </div>
      {source === 'gsc' ? <GscRankings domain={domain} onOpenSettings={onOpenSettings} /> : <DataForSeoRankings domain={domain} />}
    </div>
  );
}
