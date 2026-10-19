import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, MousePointerClick, Percent, Sparkles, Target } from 'lucide-react';
import { Fragment, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { PageLink, Tiles, Tip } from './common';

const REASONS = {
  title_missing: { label: 'Title yok', fix: 'Sayfaya ana sorguyu içeren, 50–60 karakterlik bir title ekleyin.' },
  title_long: { label: 'Title uzun', fix: 'Title 60 karakteri aşıyor ve sonuçta kesiliyor. Ana sorguyu başa alıp 50–60 karaktere indirin.' },
  title_short: { label: 'Title kısa', fix: 'Title çok kısa; fayda vaadi ekleyin (fiyat, yıl, garanti, “rehber” gibi).' },
  query_not_in_title: { label: 'Sorgu title’da yok', fix: 'En çok gösterim alan sorgu title’da geçmiyor. Arayan kişi kendi kelimesini görünce tıklar; sorguyu title’a doğal biçimde ekleyin.' },
  meta_missing: { label: 'Meta yok', fix: 'Meta açıklama yok; Google sayfadan rastgele metin seçiyor. Sorguyu ve net bir çağrıyı içeren 140–155 karakterlik açıklama yazın.' },
  meta_long: { label: 'Meta uzun', fix: 'Meta açıklama 160 karakteri aşıyor ve kesiliyor; önemli kısmı başa alın.' },
  query_not_in_meta: { label: 'Sorgu meta’da yok', fix: 'Sorgu meta açıklamada geçmiyor; Google eşleşen kelimeleri kalın gösterir, bu da tıklamayı artırır.' },
  title_duplicate: { label: 'Kopya title', fix: 'Aynı title başka sayfalarda da var; bu sayfaya özgü bir title yazın.' },
  meta_duplicate: { label: 'Kopya meta', fix: 'Aynı meta açıklama başka sayfalarda da var; sayfaya özgü yazın.' },
  no_schema: { label: 'Yapısal veri yok', fix: 'Yapısal veri (ör. Product/Review yıldızları, Breadcrumb, Article) sonuçta daha fazla yer kaplar ve tıklamayı artırır.' },
  homepage_generic: { label: 'Ana sayfa genel sorguda', fix: 'Ana sayfa marka dışı bir sorguda çıkıyor; bu sorgu için özel bir hizmet/landing sayfası daha alakalı olur ve daha çok tıklanır.' },
  serp_features: { label: 'SERP özelliği?', fix: 'İlk 3’te olmanıza rağmen düşük tıklama genelde AI Overview, öne çıkan snippet, harita veya reklamların tıklamayı çektiğini gösterir. Sorguyu Google’da kontrol edin; snippet’i hedefleyen kısa bir cevap paragrafı ekleyin.' },
  ai_overview: { label: 'AI Overview', fix: 'Bu sorgularda Google AI Overview çıkıyor ve sizi kaynak göstermiyor; tıklamaların bir kısmı özette kalıyor. Sayfanın başına soruyu 2–3 cümlede net yanıtlayan bir özet, ardından liste/tablo ekleyin; kaynak gösterilmek tıklamayı geri getirir.' },
  snippet_other: { label: 'Snippet rakipte', fix: 'Öne çıkan snippet başka bir sitede. Sorunun cevabını 40–60 kelimelik tek paragrafla, hemen ilgili H2’nin altında verin; liste/tablo biçimli snippet’lerde aynı biçimi kullanın.' },
  ads_heavy: { label: 'Yoğun reklam', fix: 'Sonuç sayfasının üstünde 3+ reklam var; organik sonuçlar aşağı itiliyor. Bu sorgularda tıklama oranı doğal olarak düşüktür; title’da fiyat/garanti gibi farklılaştırıcı vurgu öne çıkmayı sağlar.' },
  local_pack: { label: 'Harita sonuçları', fix: 'Sonuçlarda harita (yerel paket) var. Google İşletme Profilinizi optimize edin (kategori, yorum, fotoğraf) ve sayfada adres/telefon + LocalBusiness şeması kullanın.' },
  not_crawled: { label: 'Taranmadı', fix: 'Sayfa son taramada yok (tarama sınırı). Neden analizi için taramayı genişletin veya sayfayı Sayfa Analizi aracında kontrol edin.' },
};

function SerpPreview({ url, title, meta }) {
  const t = title || '(title yok)';
  const m = meta || '(meta açıklama yok — Google sayfadan metin seçer)';
  return (
    <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', maxWidth: 620 }}>
      <div className="muted truncate" style={{ fontSize: 12 }}>{shortUrl(url)}</div>
      <div style={{ color: 'var(--primary)', fontSize: 17, lineHeight: 1.35, marginTop: 2 }}>
        {t.length > 60 ? <>{t.slice(0, 60)}<span style={{ background: 'var(--critical-soft)' }}>…</span></> : t}
      </div>
      <div className="text-2" style={{ fontSize: 13, marginTop: 4 }}>
        {m.length > 158 ? <>{m.slice(0, 158)}<span style={{ background: 'var(--critical-soft)' }}>…</span></> : m}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>Yaklaşık Google görünümü: vurgulu “…” kesilen kısımları gösterir.</div>
    </div>
  );
}

function CurveChart({ curve }) {
  const data = curve.slice(0, 15).map((c) => ({ position: c.position, expected: c.expected, industry: c.industry, site: c.site }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="position" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tickMargin={6} />
        <YAxis tickFormatter={(v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          formatter={(v, name) => [v === null ? '—' : fmt.pct(v), name]} labelFormatter={(l) => `${l}. sıra`}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="expected" name="Beklenen (sitenize göre)" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="industry" name="Sektör ortalaması" stroke="var(--chart-2)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** CTR anomalisi: sıralamasına göre beklenenden belirgin şekilde az tıklanan sayfa ve sorgular (title/meta yeniden yazım adayları). */
export default function CtrView({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'ctr'], queryFn: () => insightApi.ctr(domain.id) });
  const [open, setOpen] = useState(null);
  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (data.empty) return <div className="card"><EmptyState icon={MousePointerClick} title="Henüz veri yok">Search Console senkronizasyonu tamamlandığında analiz burada görünecek.</EmptyState></div>;

  const s = data.summary;
  const lowSite = s.industryRatio < 0.5;
  return (
    <div className="stack">
      <Tiles items={[
        { label: 'Kaçırılan tıklama', value: fmt.num(s.missedClicks), icon: MousePointerClick, tone: 'warning', foot: 'son 28 gün, anomalili sayfalarda' },
        { label: 'Anomalili sayfa', value: fmt.num(s.pages), icon: Target, foot: 'title/meta yeniden yazım adayı' },
        { label: 'Anomalili sorgu', value: fmt.num(s.queries), icon: Sparkles, foot: 'sorgu × sayfa' },
        { label: 'Site geneli TO', value: fmt.pct(s.siteCtr), icon: Percent, foot: `sektörün ~%${Math.round(s.industryRatio * 100)}’i (marka dışı)` },
      ]} />

      <div className="grid grid-2-1">
        <div className="card">
          <div className="card-head"><div><h3>Beklenen tıklama oranı eğrisi</h3><p>Sitenizin marka dışı verisinden öğrenildi; az verili sıralarda sektör eğrisi sitenize göre ölçeklendi.</p></div></div>
          <div className="card-body"><CurveChart curve={data.curve} /></div>
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <h3>Nasıl hesaplanır?</h3>
          <p className="text-2" style={{ fontSize: 13 }}>
            Her sorgu × sayfa için pozisyona göre beklenen tıklama hesaplanır. Gerçek TO beklenenin <strong>%60’ından azsa</strong> ve fark
            istatistiksel olarak anlamlıysa (rastlantı olamayacak kadar büyük) anomali sayılır. Sayfa düzeyinde tüm sorgular toplanır.
          </p>
          {lowSite && (
            <Alert type="info">
              Sitenizin genel tıklama oranı sektör ortalamasının çok altında. Bu genelde arama sonuçlarındaki AI Overview / reklam yoğunluğu ya da
              bilgi amaçlı gösterimlerin fazlalığından kaynaklanır. Anomaliler sitenizin kendi normuna göre bulunur.
            </Alert>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3 className="row" style={{ gap: 8 }}><Target size={17} /> Yeniden yazılması gereken sayfalar</h3><span className="badge badge-neutral">{data.pages.length}</span></div>
        <Tip>Satıra tıklayarak sayfanın Google’daki yaklaşık görünümünü, olası nedenleri ve en çok gösterim alan sorgularını görün.</Tip>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {data.pages.length ? (
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>Sayfa</th><th className="r">Poz.</th><th className="r">Gösterim</th><th className="r">TO / Beklenen</th><th className="r">Kaçırılan</th><th>Olası neden</th></tr></thead>
              <tbody>
                {data.pages.map((p) => {
                  const isOpen = open === p.page;
                  return (
                    <Fragment key={p.page}>
                      <tr className="clickable" onClick={() => setOpen(isOpen ? null : p.page)} aria-expanded={isOpen}>
                        <td>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                        <td><PageLink url={p.page} title={p.title} max={280} /></td>
                        <td className="r"><PositionPill value={p.position} /></td>
                        <td className="r">{fmt.num(p.impressions)}</td>
                        <td className="r num" style={{ whiteSpace: 'nowrap' }}><strong>{fmt.pct(p.ctr)}</strong> / {fmt.pct(p.expectedCtr)}</td>
                        <td className="r"><span className="badge badge-warning">+{fmt.num(p.missedClicks)} tık</span></td>
                        <td><div className="row" style={{ gap: 4 }}>{p.reasons.slice(0, 3).map((r) => <span key={r} className="badge badge-neutral">{REASONS[r]?.label || r}</span>)}{p.reasons.length > 3 && <span className="muted">+{p.reasons.length - 3}</span>}</div></td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--surface-2)' }}>
                            <div className="grid grid-2" style={{ padding: '6px 4px 10px', alignItems: 'start' }}>
                              <div style={{ display: 'grid', gap: 10 }}>
                                <SerpPreview url={p.page} title={p.title} meta={p.metaDescription} />
                                {p.reasons.map((r) => REASONS[r] && <div key={r} className="issue-fix"><Sparkles size={16} /> <div><strong>{REASONS[r].label}:</strong> {REASONS[r].fix}</div></div>)}
                              </div>
                              <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
                                <table className="table">
                                  <thead><tr><th>Sorgu</th><th className="r">Poz.</th><th className="r">Gösterim</th><th className="r">TO / Bekl.</th></tr></thead>
                                  <tbody>
                                    {p.topQueries.map((q) => (
                                      <tr key={q.query}>
                                        <td className="truncate" style={{ maxWidth: 220 }}>{q.query}</td>
                                        <td className="r"><PositionPill value={q.position} /></td>
                                        <td className="r">{fmt.num(q.impressions)}</td>
                                        <td className="r num">{fmt.pct(q.ctr)} / {fmt.pct(q.expectedCtr)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState icon={Target} title="Anomali yok">Sayfalarınızın tıklama oranı pozisyonlarına göre beklenen aralıkta.</EmptyState>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3 className="row" style={{ gap: 8 }}><Sparkles size={17} /> Sorgu düzeyinde anomaliler</h3><span className="badge badge-neutral">{data.queries.length}</span></div>
        <div className="table-wrap" style={{ marginTop: 10, maxHeight: 460, overflowY: 'auto' }}>
          {data.queries.length ? (
            <table className="table">
              <thead><tr><th>Sorgu</th><th>Sayfa</th><th className="r">Poz.</th><th className="r">Gösterim</th><th className="r">TO / Beklenen</th><th className="r">Kaçırılan</th></tr></thead>
              <tbody>
                {data.queries.map((q) => (
                  <tr key={`${q.query}|${q.page}`}>
                    <td className="cell-main truncate" style={{ maxWidth: 240 }}>{q.query}</td>
                    <td className="truncate" style={{ maxWidth: 220 }}><a href={safeHref(q.page)} target="_blank" rel="noopener noreferrer" title={q.page}>{shortUrl(q.page)}</a></td>
                    <td className="r"><PositionPill value={q.position} /></td>
                    <td className="r">{fmt.num(q.impressions)}</td>
                    <td className="r num">{fmt.pct(q.ctr)} / {fmt.pct(q.expectedCtr)}</td>
                    <td className="r"><span className="badge badge-warning">+{fmt.num(q.missedClicks)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={Sparkles} title="Anomali yok" />}
        </div>
      </div>
    </div>
  );
}
