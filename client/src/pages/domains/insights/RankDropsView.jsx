import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellRing, ChevronDown, ChevronRight, CircleCheck, FileSearch, History, Search, Sparkles, Trash2, TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { countryName, fmt, safeHref, shortUrl } from '../../../utils/format';
import { PageLink, Tiles, Tip } from './common';

const busy = (a) => ['queued', 'running'].includes(a?.status);
const SEVERITY = {
  critical: { label: 'Kritik', cls: 'badge-critical' },
  warning: { label: 'Belirgin', cls: 'badge-warning' },
  notice: { label: 'Hafif', cls: 'badge-notice' },
};
const PRIORITY = {
  critical: { label: 'Acil', cls: 'badge-critical' },
  high: { label: 'Yüksek', cls: 'badge-critical' },
  medium: { label: 'Orta', cls: 'badge-warning' },
  low: { label: 'Düşük', cls: 'badge-neutral' },
  info: { label: 'Bilgi', cls: 'badge-notice' },
};
const CATEGORY = {
  technical: 'Teknik', change: 'Sayfa değişikliği', cannibalization: 'Yamyamlık', onpage: 'Sayfa içi', content: 'İçerik',
  freshness: 'Güncellik', schema: 'Yapısal veri', serp: 'Google sonuçları', links: 'İç bağlantı', algorithm: 'Google güncellemesi', demand: 'Talep', other: 'Genel',
};

/** Pozisyon çizgisi (ters eksen: 1 üstte). */
function PositionLine({ points, width = 120, height = 28, marker }) {
  const pts = points.filter((p) => p.position !== null);
  if (pts.length < 2) return <span className="muted">—</span>;
  const max = Math.max(...pts.map((p) => p.position));
  const min = Math.min(...pts.map((p) => p.position));
  const span = Math.max(1, max - min);
  const x = (i) => (i / (pts.length - 1)) * (width - 4) + 2;
  const y = (v) => ((v - min) / span) * (height - 6) + 3;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.position).toFixed(1)}`).join(' ');
  const mi = marker ? pts.findIndex((p) => p.date >= marker) : -1;
  return (
    <svg width={width} height={height} role="img" aria-label="Günlük pozisyon" style={{ display: 'block' }}>
      {mi >= 0 && <line x1={x(mi)} x2={x(mi)} y1={0} y2={height} stroke="var(--critical)" strokeDasharray="2 2" opacity={0.7} />}
      <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={1.6} />
      <circle cx={x(pts.length - 1)} cy={y(pts.at(-1).position)} r={2.2} fill="var(--critical)" />
    </svg>
  );
}

function BigChart({ a }) {
  const pts = a.history.filter((p) => p.position !== null);
  if (pts.length < 3) return null;
  const W = 760;
  const H = 180;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const max = Math.ceil(Math.max(...pts.map((p) => p.position)));
  const min = Math.max(1, Math.floor(Math.min(...pts.map((p) => p.position))));
  const t0 = Date.parse(pts[0].date);
  const t1 = Date.parse(pts.at(-1).date);
  const x = (iso) => pad.l + ((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((v - min) / Math.max(1, max - min)) * (H - pad.t - pad.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.position).toFixed(1)}`).join(' ');
  const inRange = (iso) => iso >= pts[0].date && iso <= pts.at(-1).date;
  const ticks = [min, Math.round((min + max) / 2), max].filter((v, i, arr) => arr.indexOf(v) === i);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: 'block' }} role="img" aria-label="Son 90 gün pozisyon">
        {ticks.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--text-3, currentColor)">{v}</text></g>)}
        {a.updates.filter((u) => inRange(u.start)).map((u) => (
          <g key={u.name}><line x1={x(u.start)} x2={x(u.start)} y1={pad.t} y2={H - pad.b} stroke="var(--warning)" strokeDasharray="3 3" /><title>{u.name}</title></g>
        ))}
        {a.changes.filter((c) => inRange(c.created_at.slice(0, 10))).map((c) => (
          <g key={`${c.created_at}${c.field}`}><circle cx={x(c.created_at.slice(0, 10))} cy={H - pad.b} r={4} fill="var(--notice, var(--chart-2))" /><title>{`${c.created_at.slice(0, 10)} ${c.field}: ${c.old_value ?? ''} → ${c.new_value ?? ''}`}</title></g>
        ))}
        {a.startedAt && inRange(a.startedAt) && <line x1={x(a.startedAt)} x2={x(a.startedAt)} y1={pad.t} y2={H - pad.b} stroke="var(--critical)" strokeWidth={1.5} />}
        <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={2} />
        <text x={pad.l} y={H - 6} fontSize="10" fill="var(--text-3, currentColor)">{fmt.dateShort(pts[0].date)}</text>
        <text x={W - pad.r} y={H - 6} fontSize="10" textAnchor="end" fill="var(--text-3, currentColor)">{fmt.dateShort(pts.at(-1).date)}</text>
      </svg>
      <div className="row hint" style={{ gap: 14 }}>
        <span><span style={{ color: 'var(--critical)' }}>│</span> düşüş başlangıcı</span>
        <span><span style={{ color: 'var(--warning)' }}>┆</span> Google güncellemesi</span>
        <span><span style={{ color: 'var(--chart-2)' }}>●</span> sayfa değişikliği</span>
      </div>
    </div>
  );
}

function Recs({ recs }) {
  const [open, setOpen] = useState(0);
  return recs.map((r, i) => (
    <div key={`${r.title}${i}`} className="issue">
      <button className="issue-head" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
        {open === i ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className={`badge ${PRIORITY[r.priority].cls}`}>{PRIORITY[r.priority].label}</span>
        <span className="issue-title">{r.title}</span>
        <span className="badge badge-neutral">{CATEGORY[r.category] || r.category}</span>
      </button>
      {open === i && (
        <div className="issue-body" style={{ display: 'grid', gap: 10 }}>
          {r.detail && <p className="text-2" style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{r.detail}</p>}
          {r.items?.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 2 }}>{r.items.map((x) => <li key={x}>{x}</li>)}</ul>}
          {r.steps?.length > 0 && (
            <div className="issue-fix"><Sparkles size={16} /><ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{r.steps.map((s) => <li key={s}>{s}</li>)}</ol></div>
          )}
        </div>
      )}
    </div>
  ));
}

function AnalysisDetail({ domain, id, onBack }) {
  const { data, isLoading } = useQuery({
    queryKey: ['insights', domain.id, 'rank-drop', id],
    queryFn: () => insightApi.rankDropAnalysis(domain.id, id),
    refetchInterval: (q) => (busy(q.state.data?.analysis) ? 3000 : false),
  });
  const an = data?.analysis;
  if (isLoading) return <Skeleton height={400} />;
  if (!an) return null;
  const back = <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Listeye dön</button>;
  if (busy(an)) return <div className="stack">{back}<div className="card"><EmptyState icon={FileSearch} title={`“${an.keyword}” analiz ediliyor`}><span className="row" style={{ gap: 8, justifyContent: 'center' }}><Spinner size={14} /> Pozisyon geçmişi, sayfa değişiklikleri, Google sonuçları ve rakip sayfalar inceleniyor (20–60 sn)…</span></EmptyState></div></div>;
  if (an.status === 'failed') return <div className="stack">{back}<Alert type="error">Analiz tamamlanamadı: {an.error}</Alert></div>;
  const a = an.data;
  const own = a.ourPage;

  return (
    <div className="stack">
      {back}
      <div className="card card-pad" style={{ display: 'grid', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>{a.keyword}</h2>
          <div className="row muted" style={{ gap: 8, fontSize: 13, marginTop: 4 }}>
            <span>{countryName(a.country)} · {a.language}</span>
            <span className="badge badge-neutral">{a.source === 'serp' ? 'Google ilk 10 (canlı)' : a.source === 'manual' ? 'Verilen rakip URL’leri' : 'Rakip sayfaları'}</span>
            {an.trigger === 'alert' && <span className="badge badge-notice"><BellRing size={12} /> Uyarıyla otomatik</span>}
            <span>{fmt.dateTime(a.generatedAt)}</span>
          </div>
        </div>
        {a.notes.map((n) => <Alert key={n} type="info">{n}</Alert>)}
      </div>

      <div className="grid grid-4">
        <div className="card stat"><span className="stat-label">Önceki 28 gün</span><span className="stat-value"><PositionPill value={a.baseline.position} /></span><span className="stat-foot">{fmt.num(a.baseline.clicks)} tık · {fmt.num(a.baseline.impressions)} gösterim</span></div>
        <div className="card stat"><span className="stat-label">Son 14 gün</span><span className="stat-value">{a.current.position === null ? <span className="badge badge-critical">Görünmüyor</span> : <PositionPill value={a.current.position} />}</span><span className="stat-foot">{fmt.num(a.current.clicks)} tık · {fmt.num(a.current.impressions)} gösterim</span></div>
        <div className="card stat"><span className="stat-label">Google’da şu an</span><span className="stat-value">{a.source === 'serp' ? (a.livePosition ? <PositionPill value={a.livePosition} /> : <span className="badge badge-critical">İlk 10’da yok</span>) : '—'}</span><span className="stat-foot">mobil, canlı kontrol</span></div>
        <div className="card stat"><span className="stat-label">Düşüş başlangıcı</span><span className="stat-value" style={{ fontSize: 20 }}>{a.startedAt ? fmt.dateShort(a.startedAt) : '—'}</span><span className="stat-foot">{a.updates.length ? `${a.updates.length} Google güncellemesi aynı dönemde` : 'aynı dönemde güncelleme yok'}</span></div>
      </div>

      <div className="card">
        <div className="card-head"><h3 className="row" style={{ gap: 8 }}><TrendingDown size={17} /> Son 90 gün pozisyon</h3></div>
        <div className="card-body"><BigChart a={a} /></div>
      </div>

      <div className="card">
        <div className="card-head"><div><h3 className="row" style={{ gap: 8 }}><Sparkles size={17} /> Ne yapılmalı?</h3><p>Öncelik sırasına göre, kanıtlarıyla</p></div></div>
        <div style={{ marginTop: 10 }}><Recs recs={a.recommendations} /></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Sıralanan sayfanız</h3>{a.urlSwitched && <span className="badge badge-critical">URL değişti</span>}</div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            <PageLink url={own.url} title={own.title || own.error} max={520} />
            <div className="row" style={{ gap: 6 }}>
              {own.words !== null && <span className={`badge ${a.stats.medianWords && own.words < a.stats.medianWords * 0.7 ? 'badge-warning' : 'badge-good'}`}>{fmt.num(own.words)} kelime{a.stats.medianWords ? ` · rakip medyanı ${fmt.num(a.stats.medianWords)}` : ''}</span>}
              {own.inlinks !== null && <span className={`badge ${own.siteMedianInlinks && own.inlinks < own.siteMedianInlinks * 0.5 ? 'badge-warning' : 'badge-neutral'}`}>{own.inlinks} iç bağlantı · site medyanı {own.siteMedianInlinks}</span>}
              <span className="badge badge-neutral">{own.modifiedAt ? `Güncelleme: ${fmt.dateShort(own.modifiedAt)}` : 'Tarih yok'}</span>
              {own.performance !== null && <span className={`badge ${own.performance < 50 ? 'badge-critical' : own.performance < 90 ? 'badge-warning' : 'badge-good'}`}>Mobil hız {own.performance}</span>}
              {own.schemaTypes.length > 0 && <span className="badge badge-neutral" title={own.schemaTypes.join(', ')}>{own.schemaTypes.length} şema türü</span>}
            </div>
            {own.h1 !== undefined && <div className="text-2" style={{ fontSize: 13 }}><strong>H1:</strong> {own.h1 || <span style={{ color: 'var(--critical-ink)' }}>yok</span>}</div>}
            {own.issues.length > 0 && <div className="hint">Son taramadaki sorunlar: {own.issues.map((i) => i.title).join(' · ')}</div>}
          </div>
          {a.pages && (a.pages.prev.length > 0 || a.pages.cur.length > 0) && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Bu kelimede sayfalarınız</th><th className="r">Önce</th><th className="r">Şimdi</th></tr></thead>
                <tbody>
                  {[...new Set([...a.pages.prev, ...a.pages.cur].map((p) => p.page))].slice(0, 6).map((u) => {
                    const pv = a.pages.prev.find((p) => p.page === u);
                    const cv = a.pages.cur.find((p) => p.page === u);
                    return (
                      <tr key={u}>
                        <td><a href={safeHref(u)} target="_blank" rel="noopener noreferrer" className="truncate" style={{ display: 'block', maxWidth: 300 }} title={u}>{shortUrl(u)}</a></td>
                        <td className="r">{pv ? <span title={`${pv.impressions} gösterim`}><PositionPill value={pv.position} /></span> : <span className="muted">—</span>}</td>
                        <td className="r">{cv ? <span title={`${cv.impressions} gösterim`}><PositionPill value={cv.position} /></span> : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>{a.serp ? 'Google ilk 10 (mobil)' : 'Karşılaştırılan rakip sayfalar'}</h3>{a.serp?.prevCheckedAt && <span className="hint">önceki kayıt: {fmt.dateShort(a.serp.prevCheckedAt)}</span>}</div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th className="r">#</th><th>Sayfa</th><th className="r">Kelime</th><th className="r">Güncelleme</th></tr></thead>
              <tbody>
                {(a.serp ? a.serp.top : a.competitors).map((t) => {
                  const c = a.competitors.find((x) => x.url === (t.link || t.url));
                  const moved = a.serp && a.serp.prevCheckedAt && !t.own ? (t.prevPosition === null ? 'yeni' : t.prevPosition > t.position ? `↑ ${t.prevPosition}` : null) : null;
                  return (
                    <tr key={t.link || t.url} style={t.own ? { background: 'var(--surface-2)' } : undefined}>
                      <td className="r num">{t.position ?? '—'}</td>
                      <td>
                        <a href={safeHref(t.link || t.url)} target="_blank" rel="noopener noreferrer" className="cell-main truncate" style={{ display: 'block', maxWidth: 300 }} title={t.link || t.url}>{t.own ? 'Siz · ' : ''}{t.domain}</a>
                        <div className="cell-sub truncate" style={{ maxWidth: 300 }}>{t.title}</div>
                        {moved && <span className="badge badge-warning" style={{ fontSize: 11 }}>{moved}</span>}
                      </td>
                      <td className="r num">{c ? fmt.num(c.words) : t.own && own.words ? fmt.num(own.words) : '—'}</td>
                      <td className="r" style={{ fontSize: 12 }}>{c?.modifiedAt ? fmt.dateShort(c.modifiedAt) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!a.competitors.length && !a.serp && <p className="muted" style={{ padding: 20 }}>Rakip sayfa bulunamadı.</p>}
          </div>
        </div>
      </div>

      {(a.gaps.headings.length > 0 || a.gaps.terms.length > 0 || a.gaps.questions.length > 0) && (
        <div className="grid grid-3">
          <div className="card">
            <div className="card-head"><h3>Eksik alt konular</h3><span className="badge badge-neutral">{a.gaps.headings.length}</span></div>
            <ul style={{ margin: '10px 20px 18px', paddingLeft: 18, fontSize: 13, display: 'grid', gap: 4 }}>{a.gaps.headings.map((h) => <li key={h.heading}>{h.heading} <span className="muted">· {h.pages} rakip</span></li>)}</ul>
          </div>
          <div className="card">
            <div className="card-head"><h3>Eksik terimler</h3><span className="badge badge-neutral">{a.gaps.terms.length}</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 20px 18px' }}>{a.gaps.terms.map((t) => <span key={t.term} className="badge badge-critical" title={`${t.pages} rakipte`}>{t.term}</span>)}</div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Yanıtsız sorular</h3><span className="badge badge-neutral">{a.gaps.questions.length}</span></div>
            <ul style={{ margin: '10px 20px 18px', paddingLeft: 18, fontSize: 13, display: 'grid', gap: 4 }}>{a.gaps.questions.map((q) => <li key={q.question}>{q.question} <span className="muted">· {q.source}</span></li>)}</ul>
          </div>
        </div>
      )}

      {a.changes.length > 0 && (
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><History size={17} /> Sayfadaki değişiklikler (120 gün)</h3></div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Tarih</th><th>Alan</th><th>Önce</th><th>Sonra</th></tr></thead>
              <tbody>{a.changes.map((c) => <tr key={`${c.created_at}${c.field}`}><td style={{ whiteSpace: 'nowrap' }}>{fmt.dateShort(c.created_at)}</td><td>{c.field}</td><td className="text-2 truncate" style={{ maxWidth: 260 }} title={c.old_value || ''}>{c.old_value || '—'}</td><td className="truncate" style={{ maxWidth: 260 }} title={c.new_value || ''}>{c.new_value || '—'}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualForm({ domain, onCreated }) {
  const toast = useToast();
  const [keyword, setKeyword] = useState('');
  const [urls, setUrls] = useState('');
  const create = useMutation({
    mutationFn: () => insightApi.createRankDropAnalysis(domain.id, { keyword: keyword.trim(), urls: urls.split(/\s+/).filter((u) => /^https?:\/\//i.test(u)).slice(0, 6) }),
    onSuccess: ({ analysis }) => { toast.success('Analiz başladı'); onCreated(analysis.id); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form className="card-body" style={{ display: 'grid', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) create.mutate(); }}>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="rd-kw">Herhangi bir kelimeyi analiz et</label>
          <input id="rd-kw" className="input input-sm" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ör. burun estetiği fiyatları" maxLength={200} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!keyword.trim() || create.isPending}>{create.isPending ? <Spinner size={14} /> : <FileSearch size={15} />} Analiz et</button>
      </div>
      <input className="input input-sm" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="İsteğe bağlı: karşılaştırılacak rakip URL’leri (boşlukla, en fazla 6)" aria-label="Rakip URL’leri" />
    </form>
  );
}

/**
 * Sıralama kayıpları: Search Console'da son 14 günde belirgin sıra kaybeden kelimeler ve
 * her biri için sayfa + rakip + zaman çizelgesi karşılaştırmalı, öncelikli öneriler.
 */
export default function RankDropsView({ domain }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get('analysis');
  const select = (id) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (id) n.set('analysis', id);
    else n.delete('analysis');
    return n;
  }, { replace: true });
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const drops = useQuery({ queryKey: ['insights', domain.id, 'rank-drops'], queryFn: () => insightApi.rankDrops(domain.id), enabled: !selected });
  const analyses = useQuery({
    queryKey: ['insights', domain.id, 'rank-drop-analyses'], queryFn: () => insightApi.rankDropAnalyses(domain.id),
    refetchInterval: (q) => (q.state.data?.analyses?.some(busy) ? 4000 : false),
  });
  const create = useMutation({
    mutationFn: (keyword) => insightApi.createRankDropAnalysis(domain.id, { keyword }),
    onSuccess: ({ analysis }) => {
      toast.success('Analiz başladı (20–60 sn)');
      qc.invalidateQueries({ queryKey: ['insights', domain.id, 'rank-drop-analyses'] });
      select(analysis.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id) => insightApi.removeRankDropAnalysis(domain.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insights', domain.id, 'rank-drop-analyses'] }),
  });
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    return (drops.data?.rows || []).filter((r) => (!severity || r.severity === severity) && (!q || r.query.includes(q)));
  }, [drops.data, severity, search]);

  if (selected) return <AnalysisDetail domain={domain} id={selected} onBack={() => { select(null); qc.invalidateQueries({ queryKey: ['insights', domain.id, 'rank-drop-analyses'] }); }} />;
  if (drops.isLoading) return <Skeleton height={320} />;
  if (drops.isError) return <Alert type="error">{errorMessage(drops.error)}</Alert>;
  const d = drops.data;
  const latestFor = new Map((analyses.data?.analyses || []).map((x) => [x.keyword, x]).reverse());

  return (
    <div className="stack">
      {d.insufficient ? (
        <Alert type="info">Karşılaştırma için en az 42 günlük Search Console verisi gerekir{d.days ? ` (şu an ${d.days} gün)` : ''}. Aşağıdan herhangi bir kelimeyi yine de analiz edebilirsiniz.</Alert>
      ) : (
        <Tiles items={[
          { label: 'Sıra kaybeden kelime', value: fmt.num(d.summary.total), icon: TrendingDown, foot: `son 14 gün vs önceki 28 gün` },
          { label: 'Kritik', value: fmt.num(d.summary.critical), icon: TrendingDown, tone: d.summary.critical ? 'critical' : undefined, foot: 'ilk sayfadan düşen / kaybolan' },
          { label: 'Görünmez olan', value: fmt.num(d.summary.lostKeywords), icon: Search, tone: d.summary.lostKeywords ? 'warning' : undefined, foot: 'artık gösterim almıyor' },
          { label: 'Tahmini tık kaybı', value: fmt.num(d.summary.lostClicks), icon: TrendingDown, foot: 'aylık' },
        ]} />
      )}

      {!d.insufficient && (
        <div className="card">
          <div className="card-head">
            <div><h3>Sıra kaybeden kelimeler</h3><p>{fmt.dateShort(d.range.cur[0])}–{fmt.dateShort(d.range.cur[1])} · önceki dönem {fmt.dateShort(d.range.prev[0])}–{fmt.dateShort(d.range.prev[1])}</p></div>
            <div className="row" style={{ gap: 8 }}>
              <div className="segmented" role="tablist" aria-label="Önem">
                {[['', 'Tümü'], ['critical', 'Kritik'], ['warning', 'Belirgin'], ['notice', 'Hafif']].map(([k, l]) => <button key={k} className={severity === k ? 'active' : ''} onClick={() => setSeverity(k)}>{l}</button>)}
              </div>
              <input className="input input-sm" style={{ width: 180 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kelime ara" aria-label="Kelime ara" />
            </div>
          </div>
          <Tip>“Analiz et” kelimenin düşüş tarihini, o dönemde sayfanızda ve Google’da neyin değiştiğini, üstteki rakip sayfalarla farkınızı inceler ve öncelikli yapılacaklar listesi çıkarır. Uyarı üreten düşüşler otomatik analiz edilir.</Tip>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            {rows.length ? (
              <table className="table">
                <thead><tr><th>Kelime</th><th>Son 42 gün</th><th className="r">Pozisyon</th><th className="r">Tık / ay</th><th>Önem</th><th className="r" /></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const an = r.analysis || latestFor.get(r.query);
                    return (
                      <tr key={r.query}>
                        <td style={{ maxWidth: 320 }}>
                          <div className="cell-main truncate" title={r.query}>{r.query}</div>
                          {r.page && <a href={safeHref(r.page)} target="_blank" rel="noopener noreferrer" className="cell-sub truncate" style={{ display: 'block' }} title={r.page}>{shortUrl(r.page)}</a>}
                        </td>
                        <td><PositionLine points={r.series} marker={d.range.cur[0]} /></td>
                        <td className="r"><span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><PositionPill value={r.prevPosition} /> → {r.lost ? <span className="badge badge-critical">Yok</span> : <PositionPill value={r.position} />}</span></td>
                        <td className="r num" style={{ whiteSpace: 'nowrap' }}>{fmt.num(r.prevClicks)} → <strong>{fmt.num(r.clicks)}</strong></td>
                        <td><span className={`badge ${SEVERITY[r.severity].cls}`}>{SEVERITY[r.severity].label}</span></td>
                        <td className="r">
                          {an && (an.status === 'completed' || busy(an))
                            ? <button className="btn btn-secondary btn-sm" onClick={() => select(an.id)}>{busy(an) ? <><Spinner size={13} /> Hazırlanıyor</> : <><CircleCheck size={13} /> Analizi gör</>}</button>
                            : <button className="btn btn-primary btn-sm" onClick={() => create.mutate(r.query)} disabled={create.isPending}><FileSearch size={13} /> Analiz et</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <EmptyState icon={CircleCheck} title="Belirgin sıra kaybı yok">Son 14 günde, önceki 28 güne göre ilk 20’deki kelimelerinizde belirgin bir düşüş görünmüyor.</EmptyState>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3 className="row" style={{ gap: 8 }}><History size={17} /> Analizler</h3><span className="badge badge-neutral">{analyses.data?.analyses.length ?? 0}</span></div>
        <ManualForm domain={domain} onCreated={(id) => { qc.invalidateQueries({ queryKey: ['insights', domain.id, 'rank-drop-analyses'] }); select(id); }} />
        {analyses.data?.analyses.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Kelime</th><th>Durum</th><th>Tarih</th><th className="r" /></tr></thead>
              <tbody>
                {analyses.data.analyses.map((x) => (
                  <tr key={x.id} className="clickable" onClick={() => select(x.id)}>
                    <td><div className="cell-main">{x.keyword}</div>{x.page && <div className="cell-sub truncate" style={{ maxWidth: 360 }}>{shortUrl(x.page)}</div>}</td>
                    <td>
                      {busy(x) ? <span className="badge badge-notice"><Spinner size={11} /> Hazırlanıyor</span> : x.status === 'failed' ? <span className="badge badge-critical" title={x.error}>Hata</span> : <span className="badge badge-good">Hazır</span>}
                      {x.trigger === 'alert' && <span className="badge badge-neutral" style={{ marginLeft: 4 }} title="Sıra kaybı uyarısıyla otomatik başlatıldı"><BellRing size={11} /> Otomatik</span>}
                    </td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{fmt.dateTime(x.created_at)}</td>
                    <td className="r"><button className="btn btn-ghost btn-sm" aria-label="Sil" onClick={(e) => { e.stopPropagation(); remove.mutate(x.id); }}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
