import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, FilePlus2, Radar, ShieldAlert, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { Pagination } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { RecrawlState, Tip } from './common';

const TONES = {
  threat: { label: 'Tehdit', cls: 'badge-critical', icon: ShieldAlert, color: 'var(--critical)' },
  opportunity: { label: 'Fırsat', cls: 'badge-good', icon: Sparkles, color: 'var(--good)' },
  strength: { label: 'Güçlü yön', cls: 'badge-notice', icon: Trophy, color: 'var(--primary)' },
};
const TYPE_LABELS = { blog: 'Blog / rehber', service: 'Hizmet / landing', product: 'Ürün', category: 'Kategori', location: 'Lokasyon', about: 'Kurumsal', legal: 'Yasal', home: 'Ana sayfa' };
const fmtMetric = (v, format) => (v === null || v === undefined ? '—' : format === 'pct' ? fmt.pct(v) : fmt.num(v));

function InsightCard({ i }) {
  const t = TONES[i.tone];
  return (
    <div className="card card-pad" style={{ display: 'grid', gap: 8, borderLeft: `3px solid ${t.color}` }}>
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <t.icon size={17} style={{ color: t.color, flex: 'none', marginTop: 2 }} />
        <strong style={{ lineHeight: 1.4 }}>{i.title}</strong>
      </div>
      <p className="text-2" style={{ fontSize: 13, margin: 0 }}>{i.detail}</p>
      <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
        <span className={`badge ${t.cls}`}>{t.label}</span>
        {i.metric && (
          <span className="row num" style={{ gap: 6, fontSize: 12.5 }}>
            <span>Siz <strong>{fmtMetric(i.metric.you, i.metric.format)}</strong></span><ArrowRight size={12} className="muted" /><span>Rakip <strong>{fmtMetric(i.metric.them, i.metric.format)}</strong></span>
          </span>
        )}
      </div>
    </div>
  );
}

const pctOrDash = (v) => (v === null || v === undefined ? '—' : fmt.pct(v));
const ROWS = [
  ['Yayın (son 12 ay, örneklem)', (s) => (s.newFormat ? fmt.num(s.publishedLast12m) : '—')],
  ['Site haritasındaki URL', (s) => fmt.num(s.sitemap.urls)],
  ['Son 90 günde güncellenen', (s) => (s.sitemap.withLastmod ? pctOrDash(s.sitemap.fresh90 / s.sitemap.withLastmod) : '—')],
  ['Yeni sayfa (son 30 gün)', (s) => fmt.num(Math.max(s.sitemap.new30, s.changes30?.new_pages || 0))],
  ['Diller', (s) => (s.languages ? `${s.languages.length} (${s.languages.slice(0, 6).join(', ')}${s.languages.length > 6 ? '…' : ''})` : '—')],
  ['Medyan içerik (kelime)', (s) => fmt.num(s.medianWords)],
  ['Yazar işaretlemesi', (s) => pctOrDash(s.authorShare)],
  ['Yorum/puan şeması', (s) => pctOrDash(Math.max(s.schema.Review || 0, s.schema.AggregateRating || 0))],
  ['SSS şeması', (s) => pctOrDash(s.schema.FAQPage)],
  ['Mobil LCP (gerçek kullanıcı)', (s) => (s.cwv?.lcp?.p75 ? fmt.ms(s.cwv.lcp.p75) : '—')],
  ['Core Web Vitals', (s) => (s.cwv ? (s.cwv.passes ? 'Geçiyor' : s.cwv.passes === false ? 'Geçmiyor' : '—') : '—')],
  ['Open PageRank', (s) => (s.authority?.opr != null ? s.authority.opr.toFixed(1) : '—')],
  ['Görünürlük payı (takip edilen)', (s) => (s.sov ? fmt.pct(s.sov.share) : '—')],
  ['AI Overview kaynağı (kelime)', (s) => (s.aiCitations ?? '—')],
];

export function IntelPanel({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'intel'], queryFn: () => insightApi.competitorIntel(domain.id), staleTime: 10 * 60_000 });
  const [tone, setTone] = useState('');
  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (!data.ready) return <div className="card"><EmptyState icon={Radar} title={data.needsAudit ? 'Önce site taraması gerekli' : 'Rakip taraması tamamlanınca bulgular burada'}>En az bir rakip ekleyin; tarama bitince içerik stratejisi, yayın hızı, dil kapsamı, yapısal veri, hız ve görünürlük karşılaştırılır.</EmptyState></div>;
  const insights = data.insights.filter((i) => !tone || i.tone === tone);
  const counts = data.insights.reduce((a, i) => ({ ...a, [i.tone]: (a[i.tone] || 0) + 1 }), {});
  return (
    <div className="stack">
      {data.needsRecrawl && <RecrawlState domain={domain} title="Kendi siteniz için yeni tarama önerilir">Yayın tarihleri, başlık yapısı ve site haritası takibi yeni taramayla toplanır; yayın hızı ve yazar karşılaştırmaları ondan sonra görünür.</RecrawlState>}
      {(!data.cruxEnabled || !data.serpTracked) && (
        <Alert type="info">
          Daha fazla bulgu için: {[!data.cruxEnabled && 'CRUX_API_KEY ekleyin (gerçek kullanıcı hız karşılaştırması)', !data.serpTracked && 'SERP & AI Overview görünümünden kelime takibi başlatın (görünürlük payı ve AI Overview kaynakları)'].filter(Boolean).join(' · ')}.
        </Alert>
      )}
      <div className="card">
        <div className="card-head">
          <div><h3 className="row" style={{ gap: 8 }}><Radar size={17} /> Öne çıkan bulgular</h3><p>Rakiplerle aranızdaki en büyük farklar, etkisine göre sıralı.</p></div>
          <div className="segmented" role="tablist" aria-label="Bulgu türü">
            <button className={!tone ? 'active' : ''} onClick={() => setTone('')}>Tümü ({data.insights.length})</button>
            {Object.entries(TONES).filter(([k]) => counts[k]).map(([k, t]) => <button key={k} className={tone === k ? 'active' : ''} onClick={() => setTone(k)}>{t.label} ({counts[k]})</button>)}
          </div>
        </div>
        <div className="card-body">
          {insights.length ? <div className="grid grid-2">{insights.map((i, idx) => <InsightCard key={`${i.title}${idx}`} i={i} />)}</div> : <p className="muted">Belirgin fark bulunamadı.</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Strateji karşılaştırması</h3></div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead><tr><th>Metrik</th>{data.sites.map((s) => <th key={s.hostname} className="r" style={s.own ? { color: 'var(--primary)' } : undefined}>{s.hostname}{s.own && ' (siz)'}</th>)}</tr></thead>
            <tbody>
              {ROWS.map(([label, fn]) => <tr key={label}><td className="text-2">{label}</td>{data.sites.map((s) => <td key={s.hostname} className="r num">{fn(s)}</td>)}</tr>)}
              <tr>
                <td className="text-2">İçerik türleri</td>
                {data.sites.map((s) => (
                  <td key={s.hostname} className="r" style={{ fontSize: 12 }}>
                    {Object.entries(s.types).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${TYPE_LABELS[k] || k} %${Math.round((n / Math.max(1, s.okPages)) * 100)}`).join(' · ')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-2">En çok yatırım yapılan konular</td>
                {data.sites.map((s) => <td key={s.hostname} className="r" style={{ fontSize: 12 }}>{s.topics.slice(0, 4).map((t) => `${t.topic} (${t.pages})`).join(', ') || '—'}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const KIND = {
  new_page: { label: 'Yeni sayfa', cls: 'badge-good' },
  removed_page: { label: 'Kaldırıldı', cls: 'badge-critical' },
  title: { label: 'Title değişti', cls: 'badge-notice' },
  h1: { label: 'H1 değişti', cls: 'badge-notice' },
  content_expanded: { label: 'İçerik genişletildi', cls: 'badge-warning' },
  content_reduced: { label: 'İçerik kısaltıldı', cls: 'badge-neutral' },
  schema_added: { label: 'Şema eklendi', cls: 'badge-warning' },
};

export function ChangesPanel({ domain, competitors }) {
  const [competitorId, setCompetitorId] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 50, ...(competitorId && { competitorId }), ...(kind && { kind }) };
  const { data, isLoading } = useQuery({ queryKey: ['insights', domain.id, 'comp-changes', params], queryFn: () => insightApi.competitorChanges(domain.id, params), placeholderData: keepPreviousData });
  return (
    <div className="card">
      <div className="card-head"><div><h3 className="row" style={{ gap: 8 }}><FilePlus2 size={17} /> Rakip hareketleri</h3><p>Rakipler haftalık yeniden taranır; yeni sayfa ve önemli güncellemeler bildirim olarak da gelir.</p></div></div>
      <Tip>Yeni sayfalar site haritasından tespit edilir (ilk taramadan sonra). Rakibin yeni yayınladığı konu sizde yoksa İçerik Fikirleri’nden brief oluşturun.</Tip>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <select className="select select-sm" style={{ width: 220 }} value={competitorId} onChange={(e) => { setCompetitorId(e.target.value); setPage(1); }} aria-label="Rakip">
          <option value="">Tüm rakipler</option>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.hostname}</option>)}
        </select>
        <select className="select select-sm" style={{ width: 200 }} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Değişiklik türü">
          <option value="">Tüm değişiklikler</option>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        {isLoading ? <div style={{ padding: 20 }}><Skeleton height={160} /></div> : data?.rows.length ? (
          <table className="table">
            <thead><tr><th>Tarih</th><th>Rakip</th><th>Tür</th><th>Sayfa</th><th>Detay</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(r.created_at)}</td>
                  <td>{r.hostname}</td>
                  <td><span className={`badge ${KIND[r.kind]?.cls || 'badge-neutral'}`}>{KIND[r.kind]?.label || r.kind}</span></td>
                  <td style={{ maxWidth: 280 }}><a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" className="truncate" style={{ display: 'block' }} title={r.url}>{shortUrl(r.url)}</a></td>
                  <td style={{ maxWidth: 360 }} className="text-2">
                    {r.kind === 'new_page' ? (r.new_value || '—')
                      : r.kind.startsWith('content') ? `${fmt.num(Number(r.old_value))} → ${fmt.num(Number(r.new_value))} kelime`
                        : r.old_value || r.new_value ? <span className="truncate" style={{ display: 'block' }} title={`${r.old_value || ''} → ${r.new_value || ''}`}>{r.old_value ? <s className="muted">{r.old_value}</s> : null} {r.new_value}</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState icon={FilePlus2} title="Henüz hareket yok">İlk taramadan sonraki haftalık taramalarda rakiplerin yeni sayfaları ve değişiklikleri burada listelenir.</EmptyState>}
      </div>
      {data?.total > 50 && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
    </div>
  );
}
