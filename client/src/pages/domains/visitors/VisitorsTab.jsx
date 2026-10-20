import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Code2, Eye, Gauge, KeyRound, Monitor, Radar, Route, Smartphone, Tablet, Target, Users } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { trackingApi } from '../../../api/endpoints';
import { Pagination } from '../../../components/ui/DataTable';
import { Alert, Delta, EmptyState, Modal, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, regionName, relativeChange } from '../../../utils/format';
import { CHANNELS, CONVERSIONS, DEVICES, RANGES, VITALS, duration, ratio, sourceName, vitalStatus } from './labels';
import TrackingSetup from './TrackingSetup';

const TrendChart = lazy(() => import('../../../components/charts/TrendChart'));
const DEVICE_ICONS = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

function Bar({ value, max }) {
  return <div className="bar-track" style={{ minWidth: 60 }}><div className="bar-fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>;
}

function ChannelBadge({ channel, source }) {
  const c = CHANNELS[channel] || CHANNELS.direct;
  const Icon = c.icon;
  return (
    <span className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
      <Icon size={14} style={{ color: channel === 'ai' ? 'var(--primary)' : 'var(--text-3)', flexShrink: 0 }} />
      <span>{source ? sourceName(source) : c.label}</span>
    </span>
  );
}

function KeywordChips({ items, exact }) {
  if (exact) return <span className="badge badge-good" title="Reklam kelimesi (kesin)">{exact}</span>;
  if (!items?.length) return <span className="muted">—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 320 }}>
      {items.map((k) => (
        <span key={k.query} className="badge badge-neutral" title={`Tahmini olasılık %${Math.round(k.p * 100)}`}>
          {k.query} <span className="muted">%{Math.round(k.p * 100)}</span>
        </span>
      ))}
    </div>
  );
}

function ConversionIcons({ kinds }) {
  if (!kinds?.length) return <span className="muted">—</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      {kinds.map((k) => {
        const c = CONVERSIONS[k] || CONVERSIONS.custom;
        const Icon = c.icon;
        return <span key={k} className="badge badge-good" title={c.label}><Icon size={12} /> {c.label}</span>;
      })}
    </span>
  );
}

function Stat({ icon: Icon, label, value, prev, foot }) {
  return (
    <div className="card stat">
      <span className="stat-label"><span className="stat-icon"><Icon size={16} /></span>{label}</span>
      <span className="stat-value num">{value}</span>
      <span className="stat-foot row" style={{ gap: 6 }}>{prev !== undefined && <Delta value={prev} />}{foot}</span>
    </div>
  );
}

function Empty({ text }) {
  return <p className="muted" style={{ padding: '18px 22px', fontSize: 13 }}>{text}</p>;
}

// ------------------------------------------------------------------ Bölümler
function Overview({ s, days }) {
  const [metric, setMetric] = useState('sessions');
  const t = s.totals;
  const cr = ratio(t.converted, t.sessions);
  const prevCr = ratio(t.prev_converted, t.prev_sessions);
  const compare = days > 1 ? (cur, prev) => relativeChange(cur, prev) : () => undefined;
  return (
    <>
      <div className="grid grid-4">
        <Stat icon={Users} label="Ziyaretçi" value={fmt.num(t.visitors)} prev={compare(t.visitors, t.prev_visitors)} foot="günlük tekil" />
        <Stat icon={Route} label="Oturum" value={fmt.num(t.sessions)} prev={compare(t.sessions, t.prev_sessions)} foot={`${fmt.num(t.pageviews)} sayfa görüntüleme`} />
        <Stat icon={Target} label="Dönüşüm" value={fmt.num(t.conversions)} prev={compare(t.conversions, t.prev_conversions)} foot={`${fmt.num(t.converted)} oturumda`} />
        <Stat icon={Gauge} label="Dönüşüm oranı" value={fmt.pct(cr)} prev={days > 1 && cr !== null && prevCr ? (cr - prevCr) / prevCr : undefined} foot="oturum bazında" />
      </div>
      <div className="grid grid-4">
        <div className="metric-tile"><small>Ort. etkileşim süresi</small><strong>{duration(t.avg_engaged_ms)}</strong></div>
        <div className="metric-tile"><small>Oturum başına sayfa</small><strong>{t.sessions ? (t.pageviews / t.sessions).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '—'}</strong></div>
        <div className="metric-tile"><small>Hemen çıkma</small><strong>{fmt.pct(ratio(t.bounced, t.sessions))}</strong></div>
        <div className="metric-tile"><small>Yapay zekâdan gelen</small><strong>{fmt.num(s.channels.find((c) => c.channel === 'ai')?.sessions || 0)}</strong></div>
      </div>
      {days > 1 && (
        <div className="card">
          <div className="card-head">
            <h3>Günlük trend</h3>
            <div className="segmented">
              {['sessions', 'visitors', 'conversions'].map((m) => (
                <button key={m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>{{ sessions: 'Oturum', visitors: 'Ziyaretçi', conversions: 'Dönüşüm' }[m]}</button>
              ))}
            </div>
          </div>
          <div className="card-body"><Suspense fallback={<Skeleton height={260} />}><TrendChart data={s.daily} metric={metric} height={260} /></Suspense></div>
        </div>
      )}
    </>
  );
}

function Channels({ s }) {
  const max = s.channels[0]?.sessions || 0;
  const maxSrc = s.sources[0]?.sessions || 0;
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><div><h3>Kanallar</h3><p>Ziyaretçiler siteye nereden geliyor</p></div></div>
        {s.channels.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Kanal</th><th className="r">Oturum</th><th /><th className="r">Dönüşüm oranı</th><th className="r">Ort. süre</th></tr></thead>
              <tbody>
                {s.channels.map((c) => (
                  <tr key={c.channel}>
                    <td><ChannelBadge channel={c.channel} /></td>
                    <td className="r num">{fmt.num(c.sessions)}</td>
                    <td style={{ width: '25%' }}><Bar value={c.sessions} max={max} /></td>
                    <td className="r num">{fmt.pct(ratio(c.converted, c.sessions))}</td>
                    <td className="r num muted">{duration(c.avg_engaged_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="Bu aralıkta ziyaret yok." />}
      </div>
      <div className="card">
        <div className="card-head"><div><h3>Kaynaklar</h3><p>Arama motorları, yapay zekâ asistanları, sosyal ağlar ve siteler</p></div></div>
        {s.sources.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Kaynak</th><th>Kanal</th><th className="r">Oturum</th><th /><th className="r">Dönüşen</th></tr></thead>
              <tbody>
                {s.sources.map((r) => (
                  <tr key={`${r.channel}:${r.source}`}>
                    <td className="cell-main truncate" style={{ maxWidth: 200 }}>{sourceName(r.source) || '—'}</td>
                    <td className="muted">{CHANNELS[r.channel]?.label}</td>
                    <td className="r num">{fmt.num(r.sessions)}</td>
                    <td style={{ width: '20%' }}><Bar value={r.sessions} max={maxSrc} /></td>
                    <td className="r num">{fmt.num(r.converted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="Henüz dış kaynaktan gelen ziyaret yok." />}
      </div>
    </div>
  );
}

function Keywords({ domain, days }) {
  const q = useQuery({ queryKey: ['tracking', domain.id, 'keywords', days], queryFn: () => trackingApi.keywords(domain.id, { days }) });
  const [showAll, setShowAll] = useState(false);
  if (q.isLoading) return <div className="card card-pad"><Skeleton height={200} /></div>;
  if (q.isError) return <Alert type="error">{errorMessage(q.error)}</Alert>;
  const k = q.data;
  const rows = showAll ? k.estimated : k.estimated.slice(0, 25);
  const coverage = ratio(k.coverage.matched, k.coverage.organic);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3><KeyRound size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Ziyaretçiler hangi kelimeyle geldi</h3>
          <p>Google organik ziyaretleri, giriş sayfası ve ülkeye göre Search Console verisiyle eşleştirilir</p>
        </div>
        {k.coverage.organic > 0 && <span className="badge badge-neutral">{fmt.num(k.coverage.organic)} organik Google oturumu · %{Math.round((coverage || 0) * 100)} eşleşti</span>}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {!domain.gsc_property || !k.gscAvailable ? (
          <Alert type="info">Kelime tahmini için Search Console bağlantısı ve en az bir senkronizasyon gerekli. Google aranan kelimeyi siteye göndermediği için bu bilgi yalnızca Search Console’dan çıkarılabilir.</Alert>
        ) : !k.estimated.length ? (
          <Empty text={k.coverage.organic ? 'Organik ziyaretlerin giriş sayfaları Search Console verisinde bulunamadı (yeni sayfalar 2-3 gün sonra görünür).' : 'Bu aralıkta Google organik ziyareti yok.'} />
        ) : (
          <>
            <p className="hint">
              Değerler tahminidir: Google kelimeyi göndermez. Her ziyaret, giriş sayfasının Search Console’daki kelime dağılımına (ülke ağırlıklı) göre olasılıklara bölünür; çok sayıda ziyarette toplam oldukça isabetlidir.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Anahtar kelime</th><th className="r">Tahmini oturum</th><th className="r">Tahmini dönüşen</th><th className="r">Dönüşüm oranı</th><th>En çok girilen sayfa</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.keyword}>
                      <td className="cell-main">{r.keyword}</td>
                      <td className="r num">{r.sessions.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</td>
                      <td className="r num">{r.converted.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</td>
                      <td className="r num">{r.converted > 0 ? fmt.pct(r.conversionRate) : '—'}</td>
                      <td className="muted truncate" style={{ maxWidth: 260 }} title={r.page}>{r.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {k.estimated.length > 25 && (
              <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Daha az göster' : `Tümünü göster (${k.estimated.length})`}
              </button>
            )}
          </>
        )}
        {k.paid.length > 0 && (
          <>
            <h4 style={{ fontSize: 14, marginTop: 6 }}>Reklam kelimeleri <span className="badge badge-good">kesin</span></h4>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Kelime (utm_term)</th><th>Kaynak</th><th className="r">Oturum</th><th className="r">Dönüşen</th><th className="r">Dönüşüm oranı</th></tr></thead>
                <tbody>
                  {k.paid.map((r) => (
                    <tr key={r.keyword}>
                      <td className="cell-main">{r.keyword}</td>
                      <td className="muted">{sourceName(r.source)}</td>
                      <td className="r num">{fmt.num(r.sessions)}</td>
                      <td className="r num">{fmt.num(r.converted)}</td>
                      <td className="r num">{fmt.pct(ratio(r.converted, r.sessions))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PagesAndConversions({ s }) {
  const max = s.landing[0]?.sessions || 0;
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><div><h3>Giriş sayfaları</h3><p>Ziyaretin başladığı sayfa</p></div></div>
        {s.landing.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Sayfa</th><th className="r">Oturum</th><th /><th className="r">Organik</th><th className="r">Dönüşüm oranı</th></tr></thead>
              <tbody>
                {s.landing.map((r) => (
                  <tr key={r.path}>
                    <td className="cell-main truncate" style={{ maxWidth: 240 }} title={r.path}>{r.path}</td>
                    <td className="r num">{fmt.num(r.sessions)}</td>
                    <td style={{ width: '18%' }}><Bar value={r.sessions} max={max} /></td>
                    <td className="r num muted">{fmt.num(r.organic)}</td>
                    <td className="r num">{fmt.pct(ratio(r.converted, r.sessions))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="Bu aralıkta ziyaret yok." />}
      </div>
      <div className="card">
        <div className="card-head"><div><h3>Dönüşümler</h3><p>Telefon, WhatsApp, e-posta, form ve özel hedefler</p></div></div>
        {s.conversions.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tür</th><th>Hedef</th><th className="r">Adet</th><th className="r">Oturum</th></tr></thead>
              <tbody>
                {s.conversions.map((r) => {
                  const c = CONVERSIONS[r.kind] || CONVERSIONS.custom;
                  const Icon = c.icon;
                  return (
                    <tr key={`${r.kind}:${r.name}`}>
                      <td><span className="row" style={{ gap: 6 }}><Icon size={14} style={{ color: 'var(--primary)' }} />{c.label}</span></td>
                      <td className="muted truncate" style={{ maxWidth: 220 }} title={r.name}>{r.name || '—'}</td>
                      <td className="r num">{fmt.num(r.count)}</td>
                      <td className="r num">{fmt.num(r.sessions)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty text="Henüz dönüşüm yok. Telefon, WhatsApp, e-posta bağlantıları ve formlar otomatik izlenir." />}
      </div>
    </div>
  );
}

function Audience({ s, pageviewDays }) {
  const total = s.devices.reduce((a, d) => a + d.sessions, 0);
  const maxCountry = s.countries[0]?.sessions || 0;
  const v = s.vitals;
  return (
    <div className="grid grid-3">
      <div className="card card-pad stack" style={{ gap: 12 }}>
        <h3 style={{ fontSize: 15 }}>Cihaz</h3>
        {s.devices.length ? s.devices.map((d) => {
          const Icon = DEVICE_ICONS[d.device] || Monitor;
          return (
            <div key={d.device} style={{ display: 'grid', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 6 }}><Icon size={14} /> {DEVICES[d.device] || d.device}</span>
                <span className="num">{fmt.pct(ratio(d.sessions, total))} <span className="muted">· dönüşüm {fmt.pct(ratio(d.converted, d.sessions))}</span></span>
              </div>
              <Bar value={d.sessions} max={total} />
            </div>
          );
        }) : <span className="muted">—</span>}
      </div>
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <h3 style={{ fontSize: 15 }}>Ülke</h3>
        {s.countries.length ? s.countries.map((c) => (
          <div key={c.country} className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
            <span className="truncate" style={{ minWidth: 0, flex: 1 }}>{c.country ? regionName(c.country, c.country) : 'Bilinmiyor'}</span>
            <span style={{ width: 70 }}><Bar value={c.sessions} max={maxCountry} /></span>
            <span className="num" style={{ width: 48, textAlign: 'right' }}>{fmt.num(c.sessions)}</span>
          </div>
        )) : <span className="muted">—</span>}
      </div>
      <div className="card card-pad stack" style={{ gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 15 }}>Gerçek kullanıcı Web Vitals</h3>
          <p className="hint">Ziyaretçilerin kendi cihazlarında ölçülen p75 değerleri (seçili aralık, en fazla son {pageviewDays} gün)</p>
        </div>
        {['lcp', 'inp', 'cls'].map((key) => {
          const value = v?.[key];
          const st = vitalStatus(key, value);
          return (
            <div key={key} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{VITALS[key].label} <span className="muted" style={{ fontSize: 12 }}>({fmt.num(v?.[`${key}_n`] || 0)} ölçüm)</span></span>
              {st ? <span className={`badge badge-${st}`}>{VITALS[key].format(value)}</span> : <span className="muted">—</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionModal({ domainId, session, onClose }) {
  const q = useQuery({ queryKey: ['tracking', domainId, 'session', session.id], queryFn: () => trackingApi.session(domainId, session.id) });
  const d = q.data;
  return (
    <Modal title="Ziyaret yolculuğu" onClose={onClose} width={640}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
          <ChannelBadge channel={session.channel} source={session.source} />
          <span className="muted">{fmt.dateTime(session.started_at)}</span>
          <span className="muted">{session.country ? regionName(session.country, session.country) : 'Ülke bilinmiyor'} · {DEVICES[session.device]}</span>
          <span className="muted">{duration(session.engaged_ms)} etkileşim</span>
        </div>
        {q.isLoading ? <Skeleton height={140} /> : q.isError ? <Alert type="error">{errorMessage(q.error)}</Alert> : (
          <>
            {(session.utm_term || d.likelyKeywords.length > 0) && (
              <div style={{ display: 'grid', gap: 6 }}>
                <strong style={{ fontSize: 13 }}>{session.utm_term ? 'Reklam kelimesi' : 'Muhtemel arama kelimeleri'}</strong>
                <KeywordChips items={d.likelyKeywords} exact={session.utm_term} />
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>Gezilen sayfalar</strong>
              {d.pages.length ? (
                <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
                  {d.pages.map((p) => (
                    <li key={`${p.path}:${p.created_at}`} style={{ fontSize: 13 }}>
                      <span className="cell-main">{p.path}</span>{' '}
                      <span className="muted">· {new Date(p.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · {duration(p.engaged_ms)} · %{p.max_scroll} kaydırma</span>
                    </li>
                  ))}
                </ol>
              ) : <span className="muted" style={{ fontSize: 13 }}>Sayfa ayrıntısı saklama süresi dolduğu için silinmiş.</span>}
            </div>
            {d.conversions.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <strong style={{ fontSize: 13 }}>Dönüşümler</strong>
                {d.conversions.map((c) => (
                  <div key={c.created_at + c.kind} className="row" style={{ gap: 8, fontSize: 13 }}>
                    <ConversionIcons kinds={[c.kind]} /> <span>{c.name || '—'}</span> <span className="muted">· {c.path}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Sessions({ domain, days }) {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState('');
  const [onlyConverted, setOnlyConverted] = useState(false);
  const [open, setOpen] = useState(null);
  const params = { days, page, ...(channel && { channel }), ...(onlyConverted && { converted: 'true' }) };
  const q = useQuery({
    queryKey: ['tracking', domain.id, 'sessions', params],
    queryFn: () => trackingApi.sessions(domain.id, params),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.rows || [];
  return (
    <div className="card">
      <div className="card-head">
        <div><h3><Eye size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Son ziyaretler</h3><p>Ayrıntı ve gezilen sayfalar için satıra tıklayın</p></div>
        <div className="row" style={{ gap: 10 }}>
          <select className="select select-sm" style={{ width: 170 }} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} aria-label="Kanal">
            <option value="">Tüm kanallar</option>
            {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <label className="row muted" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={onlyConverted} onChange={(e) => { setOnlyConverted(e.target.checked); setPage(1); }} /> Sadece dönüşenler
          </label>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="table">
          <thead><tr><th>Zaman</th><th>Kaynak</th><th>Arama kelimesi</th><th>Giriş sayfası</th><th className="r">Sayfa</th><th className="r">Süre</th><th>Dönüşüm</th><th>Konum</th></tr></thead>
          <tbody>
            {q.isLoading ? (
              <tr><td colSpan={8}><Skeleton height={120} /></td></tr>
            ) : rows.length ? rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(r.started_at)}</td>
                <td><ChannelBadge channel={r.channel} source={r.source} /></td>
                <td><KeywordChips items={r.likelyKeywords} exact={r.utm_term} /></td>
                <td className="truncate" style={{ maxWidth: 220 }} title={r.landing_path}>{r.landing_path}</td>
                <td className="r num">{fmt.num(r.pageviews)}</td>
                <td className="r num muted">{duration(r.engaged_ms)}</td>
                <td><ConversionIcons kinds={r.conversion_kinds} /></td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{r.country || '—'} · {DEVICES[r.device]}</td>
              </tr>
            )) : (
              <tr><td colSpan={8}><EmptyState icon={Eye} title="Bu filtrede ziyaret yok" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {q.data?.total > q.data?.pageSize && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      {open && <SessionModal domainId={domain.id} session={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ Sekme
export default function VisitorsTab({ domain }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState(28);

  const site = useQuery({ queryKey: ['tracking', id, 'site'], queryFn: () => trackingApi.get(id) });
  const hasSite = Boolean(site.data?.site);
  const summary = useQuery({
    queryKey: ['tracking', id, 'summary', days],
    queryFn: () => trackingApi.summary(id, { days }),
    enabled: hasSite,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const create = useMutation({
    mutationFn: () => trackingApi.create(id),
    onSuccess: (res) => {
      qc.setQueryData(['tracking', id, 'site'], res);
      toast.success('Takip kodu oluşturuldu');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (site.isLoading) return <Skeleton height={300} />;
  if (site.isError) return <Alert type="error">{errorMessage(site.error)}</Alert>;

  if (!hasSite) {
    return (
      <div className="card">
        <EmptyState
          icon={Radar} title="CrabRank ziyaretçi takibi"
          action={(
            <button className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Spinner size={16} /> : <Code2 size={16} />} Takip kodu oluştur
            </button>
          )}
        >
          <span style={{ display: 'block', maxWidth: 560, margin: '0 auto' }}>
            {domain.hostname} için bir takip kodu oluşturun ve sitenize ekleyin. Ziyaretçilerin hangi kanaldan ve hangi anahtar kelimeyle geldiğini,
            yapay zekâ asistanlarından gelen trafiği, telefon/WhatsApp/form dönüşümlerini ve gerçek kullanıcı hızını görün.
            Çerez kullanmaz, IP saklamaz.
          </span>
        </EmptyState>
      </div>
    );
  }

  const s = summary.data;
  return (
    <div className="stack">
      <TrackingSetup domain={domain} data={site.data} />
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ fontSize: 17 }}>Ziyaretçi analitiği</h2>
        <div className="row" style={{ gap: 8 }}>
          {summary.isFetching && <Spinner size={14} />}
          <div className="segmented" role="tablist" aria-label="Tarih aralığı">
            {RANGES.map((r) => <button key={r.value} className={days === r.value ? 'active' : ''} onClick={() => setDays(r.value)} role="tab" aria-selected={days === r.value}>{r.label}</button>)}
          </div>
        </div>
      </div>
      {summary.isError ? <Alert type="error">{errorMessage(summary.error)}</Alert> : !s ? <Skeleton height={300} /> : !s.totals.sessions && !s.totals.prev_sessions ? (
        <div className="card">
          <EmptyState icon={Clock} title="Henüz ziyaret verisi yok">
            Kodu sitenize ekledikten sonra ilk ziyaretler birkaç saniye içinde burada görünür. “Kurulumu doğrula” ile kodun yerinde olup olmadığını kontrol edin.
          </EmptyState>
        </div>
      ) : (
        <>
          <Overview s={s} days={days} />
          <Keywords domain={domain} days={days} />
          <Channels s={s} />
          <PagesAndConversions s={s} />
          <Audience s={s} pageviewDays={site.data.retention.pageviewDays} />
          <Sessions domain={domain} days={days} />
        </>
      )}
    </div>
  );
}
