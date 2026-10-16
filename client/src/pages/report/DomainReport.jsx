import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { backlinkApi, domainApi, indexApi, rankingApi } from '../../api/endpoints';
import { PositionPill } from '../../components/ui/DataTable';
import { Delta, ScoreRing, SeverityBadge, Spinner } from '../../components/ui/Feedback';
import { countryName, fmt, relativeChange, shortUrl } from '../../utils/format';

const Section = ({ title, children }) => (
  <section className="card card-pad report-section" style={{ display: 'grid', gap: 12 }}>
    <h2 style={{ fontSize: 17 }}>{title}</h2>
    {children}
  </section>
);

const Kpi = ({ label, value, delta, invert, mode }) => (
  <div className="metric-tile">
    <small>{label}</small>
    <strong className="num">{value}</strong>
    {delta !== undefined && <span style={{ fontSize: 12 }}><Delta value={delta} invert={invert} mode={mode} /> önceki döneme göre</span>}
  </div>
);

/** Müşteriye gönderilecek tek sayfalık rapor; tarayıcının "PDF olarak kaydet" özelliğiyle dışa aktarılır. */
export default function DomainReport() {
  const { id } = useParams();
  const days = 28;
  const domain = useQuery({ queryKey: ['domain', id], queryFn: () => domainApi.get(id) });
  const d = domain.data?.domain;
  const gsc = Boolean(d?.gsc_property);
  const perf = useQuery({ queryKey: ['gsc', id, 'performance', days], queryFn: () => domainApi.performance(id, { days }), enabled: gsc });
  const kw = useQuery({
    queryKey: ['report', id, 'kw'],
    queryFn: () => domainApi.keywords(id, { days, sort: 'clicks', order: 'desc', page: 1, pageSize: 15, minImpressions: 20 }),
    enabled: gsc,
  });
  const countries = useQuery({ queryKey: ['report', id, 'countries'], queryFn: () => rankingApi.gscSummary(id, { scope: 'all' }), enabled: gsc });
  const gaps = useQuery({ queryKey: ['gsc', id, 'content-gaps'], queryFn: () => domainApi.contentGaps(id), enabled: gsc });
  const index = useQuery({ queryKey: ['index', id, 'summary'], queryFn: () => indexApi.summary(id), enabled: gsc });
  const audit = useQuery({ queryKey: ['audit', id], queryFn: () => domainApi.latestAudit(id) });
  const psi = useQuery({ queryKey: ['psi', id], queryFn: () => domainApi.pagespeed(id) });
  const bl = useQuery({ queryKey: ['backlinks', id, 'summary'], queryFn: () => backlinkApi.summary(id) });

  if (domain.isLoading) return <div className="center-screen"><Spinner /></div>;
  if (!d) return <div className="center-screen">Alan adı bulunamadı</div>;

  const cur = perf.data?.current;
  const prev = perf.data?.previous;
  const issues = (audit.data?.issues || []).filter((i) => i.severity !== 'notice').slice(0, 8);

  return (
    <div className="report">
      <header className="row" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <div>
          <div className="muted" style={{ fontSize: 12.5 }}>SEO Performans Raporu · CrabsMedia</div>
          <h1 style={{ fontSize: 26 }}>{d.hostname}</h1>
          <div className="text-2" style={{ fontSize: 13 }}>
            {perf.data?.range ? `${fmt.dateShort(perf.data.range.start)} – ${fmt.dateShort(perf.data.range.end)}` : `Son ${days} gün`} · Oluşturulma {fmt.dateTime(new Date())}
          </div>
        </div>
        <button className="btn btn-primary no-print" onClick={() => window.print()}><Printer size={16} /> PDF olarak kaydet</button>
      </header>

      <div className="stack">
        {gsc && cur && (
          <Section title="Organik performans (Google)">
            <div className="grid grid-4" style={{ gap: 12 }}>
              <Kpi label="Tıklama" value={fmt.num(cur.clicks)} delta={relativeChange(cur.clicks, prev.clicks)} />
              <Kpi label="Gösterim" value={fmt.num(cur.impressions)} delta={relativeChange(cur.impressions, prev.impressions)} />
              <Kpi label="Tıklama oranı" value={fmt.pct(cur.ctr)} delta={relativeChange(cur.ctr, prev.ctr)} />
              <Kpi label="Ort. pozisyon" value={fmt.pos(cur.position)} delta={cur.position !== null && prev.position !== null ? cur.position - prev.position : null} invert mode="abs" />
            </div>
          </Section>
        )}

        {gsc && !!kw.data?.rows?.length && (
          <Section title="En çok trafik getiren anahtar kelimeler">
            <table className="table">
              <thead><tr><th>Anahtar kelime</th><th className="r">Tıklama</th><th className="r">Gösterim</th><th className="r">Pozisyon</th><th className="r">Değişim</th></tr></thead>
              <tbody>
                {kw.data.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.key}</td><td className="r">{fmt.num(r.clicks)}</td><td className="r">{fmt.num(r.impressions)}</td>
                    <td className="r"><PositionPill value={r.position} /></td>
                    <td className="r">{r.prev_position === null ? 'Yeni' : <Delta value={r.change} mode="abs" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {gsc && !!countries.data?.countries?.length && (
          <Section title="Ülkelere göre görünürlük">
            <table className="table">
              <thead><tr><th>Ülke</th><th className="r">Kelime</th><th className="r">İlk 10</th><th className="r">Tıklama</th><th className="r">Gösterim</th><th className="r">Ort. sıra</th></tr></thead>
              <tbody>
                {countries.data.countries.slice(0, 10).map((c) => (
                  <tr key={c.country}>
                    <td>{countryName(c.country)}</td><td className="r">{fmt.num(c.keywords)}</td><td className="r">{fmt.num(c.top10)}</td>
                    <td className="r">{fmt.num(c.clicks)}</td><td className="r">{fmt.num(c.impressions)}</td><td className="r"><PositionPill value={c.position} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <div className="grid grid-3" style={{ gap: 16 }}>
          <Section title="Site sağlığı">
            <div className="row" style={{ gap: 16, flexWrap: 'nowrap' }}>
              <ScoreRing score={audit.data?.audit?.score ?? null} size={96} label="Sağlık" />
              <div className="text-2" style={{ fontSize: 13 }}>
                {audit.data?.summary ? <>{audit.data.summary.critical} kritik · {audit.data.summary.warning} uyarı<br />{audit.data.audit.pages_crawled} sayfa tarandı</> : 'Tarama yok'}
              </div>
            </div>
          </Section>
          <Section title="Mobil hız">
            <div className="row" style={{ gap: 16, flexWrap: 'nowrap' }}>
              <ScoreRing score={psi.data?.mobile?.performance ?? null} size={96} label="Mobil" />
              <div className="text-2" style={{ fontSize: 13 }}>
                LCP {psi.data?.mobile?.metrics?.lcp?.display || '—'}<br />CLS {psi.data?.mobile?.metrics?.cls?.display || '—'}
              </div>
            </div>
          </Section>
          <Section title="Backlink ve indeks">
            <div className="text-2" style={{ fontSize: 13, display: 'grid', gap: 6 }}>
              <span>Bağlantı veren alan adı: <strong>{fmt.num(bl.data?.totals?.referring_domains)}</strong></span>
              <span>Aktif / kayıp (30g): <strong>{fmt.num(bl.data?.totals?.active)} / {fmt.num(bl.data?.totals?.lost_30d)}</strong></span>
              {gsc && <span>Google’da indeksli: <strong>{fmt.num(index.data?.totals?.indexed)} / {fmt.num(index.data?.totals?.inspected)}</strong></span>}
            </div>
          </Section>
        </div>

        {!!issues.length && (
          <Section title="Öncelikli teknik düzeltmeler">
            <div style={{ display: 'grid', gap: 10 }}>
              {issues.map((i) => (
                <div key={i.code} style={{ display: 'grid', gap: 2 }}>
                  <div className="row" style={{ gap: 8 }}><SeverityBadge severity={i.severity} /><strong>{i.title}</strong><span className="muted">({i.siteLevel ? 'site geneli' : `${i.pages} sayfa`})</span></div>
                  <div className="text-2" style={{ fontSize: 13 }}>{i.fix}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {gsc && !!gaps.data?.rows?.length && (
          <Section title="Önerilen içerik iyileştirmeleri">
            <table className="table">
              <thead><tr><th>Sorgu</th><th>Sayfa</th><th className="r">Poz.</th><th className="r">Potansiyel</th></tr></thead>
              <tbody>
                {gaps.data.rows.slice(0, 10).map((r) => (
                  <tr key={`${r.query}|${r.page}`}>
                    <td>{r.query}</td><td>{shortUrl(r.page)}</td><td className="r"><PositionPill value={r.position} /></td><td className="r">+{fmt.num(r.potential)} tık/ay</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">Bu sorguları ilgili sayfanın title, H2 başlığı ve ilk paragrafında işlemek önerilir.</p>
          </Section>
        )}
      </div>
    </div>
  );
}
