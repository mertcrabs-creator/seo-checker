import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Globe, Link2, Link2Off, Plus, RefreshCw, Search, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { backlinkApi } from '../../../api/endpoints';
import { DataTable, Pagination } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Modal, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { useTableState } from '../../../hooks/useTableState';
import { fmt, safeHref, shortUrl } from '../../../utils/format';

const STATUS = {
  active: { label: 'Aktif', cls: 'badge-good' },
  lost: { label: 'Kayıp', cls: 'badge-critical' },
  unverified: { label: 'Bekliyor', cls: 'badge-neutral' },
  not_found: { label: 'Bağlantı yok', cls: 'badge-warning' },
  error: { label: 'Ulaşılamadı', cls: 'badge-warning' },
};
const REL = { dofollow: 'badge-good', nofollow: 'badge-neutral', ugc: 'badge-notice', sponsored: 'badge-notice' };
const RISK_REASONS = {
  spam_tld: 'Spam alan adı uzantısı', link_farm: '150+ dış bağlantı (link çiftliği)', spam_content: 'Şüpheli içerik (bahis, yetişkin vb.)',
  source_noindex: 'Kaynak sayfa noindex', redirect_offsite: 'Başka siteye yönleniyor',
};
const VIEWS = [
  { key: 'active', label: 'Aktif' }, { key: 'lost', label: 'Kayıp' }, { key: 'risky', label: 'Riskli' },
  { key: 'pending', label: 'Bekleyen' }, { key: 'not_found', label: 'Bağlantı yok' }, { key: 'all', label: 'Tümü' },
];

const URL_RE = /https?:\/\/[^\s"'<>,;]+/i;

/** Basit CSV ayrıştırıcı (tırnaklı alanlar, virgül/noktalı virgül/tab ayırıcı). */
function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const firstUrl = (s) => String(s || '').match(URL_RE)?.[0]?.replace(/[).\]]+$/, '') || null;

/**
 * CSV/metinden bağlantı kayıtları. Başlık satırı varsa kaynak/hedef/anchor sütunları adından tanınır
 * (Bing "Backlinks → Pages", Search Console "En son bağlantılar"); yoksa satırdaki ilk URL kaynak sayılır.
 */
function extractLinks(text, hostname) {
  const own = hostname.replace(/^www\./, '').toLowerCase();
  const isOwn = (u) => {
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
      return h === own || h.endsWith(`.${own}`);
    } catch {
      return false;
    }
  };
  const rows = parseCsv(text);
  const header = (rows[0] || []).map((h) => h.toLowerCase().trim());
  const find = (re) => header.findIndex((h) => re.test(h));
  const hasHeader = rows[0] && !rows[0].some((c) => URL_RE.test(c));
  const col = hasHeader
    ? {
        source: find(/source|kaynak|linking|referring|bağlantı veren|from/),
        target: find(/target|hedef|destination|to url|bağlantı verilen/),
        anchor: find(/anchor|bağlantı metni/),
      }
    : { source: -1, target: -1, anchor: -1 };
  const out = new Map();
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const urls = r.map(firstUrl).filter(Boolean);
    const source = (col.source >= 0 ? firstUrl(r[col.source]) : null) || urls.find((u) => !isOwn(u));
    if (!source || isOwn(source) || out.has(source)) continue;
    const target = (col.target >= 0 ? firstUrl(r[col.target]) : null) || urls.find(isOwn) || null;
    const anchor = col.anchor >= 0 ? (r[col.anchor] || '').trim().slice(0, 500) || null : null;
    out.set(source, { source, target, anchor });
  }
  return [...out.values()];
}

const SOURCES = {
  bing: {
    label: 'Bing dışa aktarımı',
    help: <>Bing Webmaster Tools → <strong>Backlinks</strong> → <strong>Pages</strong> sekmesi → <strong>Download all</strong> ile CSV indirin. “Domains” sekmesinin dosyası sayfa adresi içermediği için “Pages” dosyasını kullanın.</>,
  },
  gsc: {
    label: 'Search Console dışa aktarımı',
    help: <>Search Console → <strong>Bağlantılar</strong> → “Bağlantı veren en popüler siteler” yanındaki <strong>Dışa aktar → En son bağlantılar</strong> ile CSV indirin. Google bu veriyi API’den vermediği için bu adım elle yapılır.</>,
  },
  manual: { label: 'Elle ekle', help: <>Satır başına bir URL: link aldığınız (ör. tanıtım yazısı, rehber, forum) sayfaların adresleri.</> },
};

function ImportModal({ domainId, hostname, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [source, setSource] = useState('bing');
  const [progress, setProgress] = useState(null);
  const items = useMemo(() => extractLinks(text, hostname), [text, hostname]);
  const withAnchor = items.filter((i) => i.anchor).length;

  const run = useMutation({
    mutationFn: async () => {
      let added = 0;
      for (let i = 0; i < items.length; i += 300) {
        setProgress({ done: i, total: items.length });
        added += (await backlinkApi.importUrls(domainId, { items: items.slice(i, i + 300), source })).added;
      }
      return added;
    },
    onSuccess: (added) => {
      toast.success(`${fmt.num(added)} bağlantı eklendi, doğrulanıyor`);
      qc.invalidateQueries({ queryKey: ['backlinks', domainId] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setProgress(null),
  });

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast.error('Dosya 20 MB’dan büyük olamaz');
    setText(await file.text());
  };

  return (
    <Modal
      title="Backlink içe aktar" onClose={onClose} width={720}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={() => run.mutate()} disabled={!items.length || run.isPending}>
            {run.isPending ? <><Spinner size={15} /> {progress ? `${fmt.num(progress.done)}/${fmt.num(progress.total)}` : ''}</> : `${fmt.num(items.length)} bağlantıyı ekle`}
          </button>
        </>
      }
    >
      <div className="segmented" style={{ justifySelf: 'start' }}>
        {Object.entries(SOURCES).map(([k, s]) => (
          <button key={k} className={source === k ? 'active' : ''} onClick={() => setSource(k)}>{s.label}</button>
        ))}
      </div>
      {source === 'manual' ? <p className="text-2" style={{ fontSize: 13 }}>{SOURCES.manual.help}</p> : <Alert type="info">{SOURCES[source].help}</Alert>}
      <div className="field">
        <label htmlFor="bl-file">CSV dosyası</label>
        <input id="bl-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} className="input" />
      </div>
      <div className="field">
        <label htmlFor="bl-text">veya URL’leri yapıştırın</label>
        <textarea id="bl-text" className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://blog.ornek.com/yazi" style={{ fontFamily: 'monospace', fontSize: 12.5, height: 'auto' }} />
        <span className="hint">
          {fmt.num(items.length)} benzersiz bağlantı veren sayfa bulundu{withAnchor ? `, ${fmt.num(withAnchor)} tanesinde anchor metni var` : ''}. Kendi sitenizin adresleri otomatik atlanır;
          her sayfa eklendikten sonra ziyaret edilerek doğrulanır.
        </span>
      </div>
    </Modal>
  );
}

function Bars({ rows, label, value }) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((r) => (
        <div key={label(r)} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
          <span className="truncate text-2" style={{ width: 200, flex: 'none', fontSize: 13 }} title={label(r)}>{label(r)}</span>
          <div className="bar-cell" style={{ flex: 1 }}>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(value(r) / max) * 100}%` }} /></div>
            <strong className="num" style={{ minWidth: 32, textAlign: 'right' }}>{fmt.num(value(r))}</strong>
          </div>
        </div>
      ))}
      {!rows.length && <p className="muted">Veri yok</p>}
    </div>
  );
}

function LinksTable({ domainId, running }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useTableState({ sort: 'first_seen' });
  const { setPage } = t;
  const [status, setStatus] = useState('active');
  const [rel, setRel] = useState('');
  useEffect(() => setPage(1), [status, rel, setPage]);
  const params = { ...t.params, status, ...(rel && { rel }) };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['backlinks', domainId, 'list', params],
    queryFn: () => backlinkApi.list(domainId, params),
    placeholderData: keepPreviousData,
    refetchInterval: running ? 5000 : false,
  });
  const remove = useMutation({
    mutationFn: (bid) => backlinkApi.remove(domainId, bid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backlinks', domainId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns = useMemo(() => [
    {
      key: 'source_domain', label: 'Bağlantı veren sayfa', sortable: true,
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <a href={safeHref(r.source_url)} target="_blank" rel="noopener noreferrer nofollow" className="cell-main truncate" style={{ display: 'block', maxWidth: 320 }} title={r.source_url}>{r.source_domain}</a>
          <div className="cell-sub truncate" style={{ maxWidth: 320 }}>{shortUrl(r.source_url)} · {r.sources.map((s) => ({ bing: 'Bing', gsc: 'Search Console', manual: 'Elle' }[s] || s)).join(', ')}</div>
        </div>
      ),
    },
    {
      key: 'anchor', label: 'Anchor → hedef',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div className="truncate" style={{ maxWidth: 240 }}>{r.anchor || <span className="muted">(boş / görsel)</span>}</div>
          {r.target_url && <div className="cell-sub truncate" style={{ maxWidth: 240 }} title={r.target_url}>{shortUrl(r.target_url)}</div>}
        </div>
      ),
    },
    { key: 'rel', label: 'Tür', render: (r) => (r.rel ? <span className={`badge ${REL[r.rel]}`}>{r.rel}</span> : '—') },
    {
      key: 'status', label: 'Durum',
      render: (r) => (
        <span className={`badge ${STATUS[r.status]?.cls}`} title={r.error || (r.http_status ? `HTTP ${r.http_status}` : '')}>
          {STATUS[r.status]?.label || r.status}
        </span>
      ),
    },
    {
      key: 'risk_score', label: 'Risk', sortable: true, align: 'right',
      render: (r) => (r.risk_score
        ? <span className={`badge ${r.risk_score >= 40 ? 'badge-critical' : 'badge-warning'}`} title={r.risk_reasons.map((x) => RISK_REASONS[x] || x).join(', ')}>{r.risk_score}</span>
        : <span className="muted">—</span>),
    },
    { key: 'first_seen', label: 'İlk görülme', sortable: true, align: 'right', render: (r) => <span className="muted">{fmt.dateTime(r.first_seen)}</span> },
    { key: 'last_checked', label: 'Son kontrol', sortable: true, align: 'right', render: (r) => <span className="muted">{r.last_checked ? fmt.dateTime(r.last_checked) : '—'}</span> },
    {
      key: 'x', label: '', align: 'right',
      render: (r) => (
        <button className="btn btn-ghost btn-sm btn-icon" title="Listeden kaldır" aria-label="Listeden kaldır" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
          <Trash2 size={14} />
        </button>
      ),
    },
  ], [remove]);

  return (
    <>
      <div className="toolbar">
        <div className="segmented">
          {VIEWS.map((v) => <button key={v.key} className={status === v.key ? 'active' : ''} onClick={() => setStatus(v.key)}>{v.label}</button>)}
        </div>
        <select className="select select-sm" style={{ width: 140 }} value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Bağlantı türü">
          <option value="">Tüm türler</option>
          {Object.keys(REL).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="URL veya anchor ara…" value={t.search} onChange={(e) => t.setSearch(e.target.value)} maxLength={200} />
        </div>
        {isFetching && !isLoading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--text-3)' }} />}
      </div>
      <DataTable
        columns={columns} rows={data?.rows || []} loading={isLoading} sort={t.sort} order={t.order} onSort={t.onSort}
        rowKey={(r) => r.id} empty={<EmptyState icon={Link2} title="Bu filtrede bağlantı yok" />}
      />
      {!!data?.total && <Pagination page={t.page} pageSize={params.pageSize} total={data.total} onPage={t.setPage} />}
    </>
  );
}

function DomainsTable({ domainId }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 50, ...(search.trim() && { search: search.trim() }) };
  const { data, isLoading } = useQuery({
    queryKey: ['backlinks', domainId, 'domains', params],
    queryFn: () => backlinkApi.domains(domainId, params),
    placeholderData: keepPreviousData,
  });
  const columns = [
    { key: 'source_domain', label: 'Alan adı', render: (r) => <span className="cell-main">{r.source_domain}</span> },
    { key: 'active', label: 'Aktif bağlantı', align: 'right', render: (r) => fmt.num(r.active) },
    { key: 'dofollow', label: 'Dofollow', align: 'right', render: (r) => fmt.num(r.dofollow) },
    { key: 'lost', label: 'Kayıp', align: 'right', render: (r) => (r.lost ? <span className="badge badge-critical">{r.lost}</span> : '—') },
    { key: 'risk', label: 'Risk', align: 'right', render: (r) => (r.risk ? <span className={`badge ${r.risk >= 40 ? 'badge-critical' : 'badge-warning'}`}>{r.risk}</span> : '—') },
    { key: 'first_seen', label: 'İlk görülme', align: 'right', render: (r) => <span className="muted">{fmt.dateTime(r.first_seen)}</span> },
  ];
  return (
    <>
      <div className="toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input className="input input-sm" placeholder="Alan adı ara…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} maxLength={200} />
        </div>
      </div>
      <DataTable columns={columns} rows={data?.rows || []} loading={isLoading} rowKey={(r) => r.source_domain} empty={<EmptyState icon={Globe} title="Alan adı yok" />} />
      {!!data?.total && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
    </>
  );
}

/** Siteye gelen bağlantılar: keşif, doğrulama, kayıp takibi ve risk analizi. */
export default function BacklinksTab({ domain }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [view, setView] = useState('links');
  const summary = useQuery({
    queryKey: ['backlinks', id, 'summary'],
    queryFn: () => backlinkApi.summary(id),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 4000 : false),
  });
  const running = summary.data?.status === 'running';

  // Tarama bittiğinde listeleri tazele
  const [prevRunning, setPrevRunning] = useState(false);
  if (running !== prevRunning) {
    if (prevRunning && !running) qc.invalidateQueries({ queryKey: ['backlinks', id] });
    setPrevRunning(running);
  }

  const refresh = useMutation({
    mutationFn: () => backlinkApi.refresh(id),
    onSuccess: () => {
      toast.success('Backlink taraması başladı');
      qc.invalidateQueries({ queryKey: ['backlinks', id, 'summary'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disavow = useMutation({
    mutationFn: () => backlinkApi.disavow(id),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `disavow-${domain.hostname}.txt` });
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (summary.isLoading) return <Skeleton height={320} />;
  if (summary.isError) return <Alert type="error">{errorMessage(summary.error)}</Alert>;
  const s = summary.data;
  const tot = s.totals;
  const dofollowPct = tot.active ? tot.dofollow / tot.active : null;

  return (
    <div className="stack">
      <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h3 className="row" style={{ gap: 8, fontSize: 15 }}><Link2 size={17} /> Backlink takibi</h3>
          <p className="text-2" style={{ fontSize: 13 }}>
            Kaynaklar: {s.bingEnabled ? 'Bing Webmaster (otomatik)' : 'Bing bağlı değil'} · Search Console CSV · elle ekleme. Her bağlantı sayfası ziyaret edilerek doğrulanır.
            {s.updatedAt && <span className="muted"> · Son tarama {fmt.dateTime(s.updatedAt)}</span>}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={() => setModal(true)}><Upload size={15} /> İçe aktar / ekle</button>
          <button className="btn btn-secondary btn-sm" onClick={() => disavow.mutate()} disabled={!tot.risky || disavow.isPending} title="Riskli alan adları için Google disavow dosyası">
            <Download size={15} /> Disavow
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => refresh.mutate()} disabled={running || refresh.isPending || (!s.bingEnabled && !tot.links)}>
            <RefreshCw size={15} className={running ? 'spin' : ''} /> {running ? 'Taranıyor…' : 'Tara ve doğrula'}
          </button>
        </div>
      </div>

      {!s.bingEnabled && (
        <Alert type="info">
          Otomatik keşif için ücretsiz Bing Webmaster Tools API anahtarı ekleyin: bing.com/webmasters → siteyi ekleyin (Search Console’dan tek tıkla içe aktarılabilir)
          → <strong>Ayarlar → API Erişimi</strong> → anahtarı sunucudaki <code>.env</code> dosyasına <code>BING_WEBMASTER_API_KEY</code> olarak yazın.
        </Alert>
      )}
      {s.error && <Alert type={s.status === 'failed' ? 'error' : 'warning'}>{s.error}</Alert>}

      {!tot.links ? (
        <div className="card">
          <EmptyState
            icon={Link2} title={running ? 'Bağlantılar toplanıyor' : 'Henüz backlink yok'}
            action={<button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={16} /> Bağlantı ekle</button>}
          >
            {s.bingEnabled
              ? '“Tara ve doğrula” ile Bing’in bildiği bağlantıları çekin veya Search Console’un Bağlantılar raporunu içe aktarın.'
              : 'Search Console → Bağlantılar raporunu CSV olarak dışa aktarıp yükleyin veya link aldığınız sayfaları elle ekleyin.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-4">
            {[
              [Globe, 'Bağlantı veren alan adı', fmt.num(tot.referring_domains), `${fmt.num(tot.active)} aktif bağlantı`],
              [Link2, 'Dofollow oranı', fmt.pct(dofollowPct), `${fmt.num(tot.dofollow)} dofollow`],
              [Plus, 'Yeni (30 gün)', fmt.num(tot.new_30d), `${fmt.num(tot.pending)} doğrulama bekliyor`],
              [Link2Off, 'Kayıp (30 gün)', fmt.num(tot.lost_30d), `${fmt.num(tot.risky)} riskli bağlantı`],
            ].map(([Icon, label, value, foot]) => (
              <div key={label} className="card stat">
                <span className="stat-label"><span className="stat-icon"><Icon size={16} /></span>{label}</span>
                <span className="stat-value num">{value}</span>
                <span className="stat-foot">{foot}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-3">
            <div className="card card-pad" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <h3 style={{ fontSize: 15 }}>Anchor metinleri</h3>
              <Bars rows={s.anchors} label={(r) => r.anchor} value={(r) => r.links} />
            </div>
            <div className="card card-pad" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <h3 style={{ fontSize: 15 }}>En çok bağlantı alan sayfalar</h3>
              <Bars rows={s.targets} label={(r) => shortUrl(r.target_url)} value={(r) => r.domains} />
              <span className="hint">Bağlantı veren alan adı sayısı</span>
            </div>
            <div className="card card-pad" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <h3 style={{ fontSize: 15 }}>En çok bağlantı veren alan adları</h3>
              <Bars rows={s.topDomains} label={(r) => r.source_domain} value={(r) => r.links} />
              {!!tot.risky && (
                <p className="hint row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <ShieldAlert size={14} style={{ flex: 'none', marginTop: 2, color: 'var(--critical)' }} />
                  {tot.risky} riskli bağlantı var. Gözden geçirip gerekirse disavow dosyasını Search Console’a yükleyin.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head" style={{ paddingBottom: 14 }}>
              <div className="segmented">
                <button className={view === 'links' ? 'active' : ''} onClick={() => setView('links')}>Bağlantılar ({fmt.num(tot.links)})</button>
                <button className={view === 'domains' ? 'active' : ''} onClick={() => setView('domains')}>Alan adları</button>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {view === 'links' ? <LinksTable domainId={id} running={running} /> : <DomainsTable domainId={id} />}
            </div>
          </div>
        </>
      )}

      {modal && <ImportModal domainId={id} hostname={domain.hostname} onClose={() => setModal(false)} />}
    </div>
  );
}
