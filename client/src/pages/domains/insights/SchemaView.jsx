import { useQuery } from '@tanstack/react-query';
import { Binary, ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, ExternalLink, Lightbulb, TriangleAlert } from 'lucide-react';
import { Fragment, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { Alert, EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { NoAuditState } from '../site/shared';
import { PageLink, RecrawlState, Tiles, Tip } from './common';

const richTest = (url) => `https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}`;
const HINT_INFO = {
  Article: 'Blog/haber içeriği tespit edildi (article etiketi, yayın tarihi). Article/BlogPosting ile yazar ve tarih bilgisi sonuçlarda görünür.',
  Product: 'Ürün/sepet sinyali tespit edildi. Product + Offer (fiyat, stok) ile fiyat ve stok bilgisi sonuçlarda gösterilebilir.',
  FAQPage: 'Soru başlıkları tespit edildi. FAQPage işaretlemesi içeriği yapılandırır; SSS zengin sonuçları ise Google’da yalnızca otoriter sağlık/kamu sitelerinde gösterilir.',
  BreadcrumbList: 'Sayfada breadcrumb menüsü var ama işaretlenmemiş. BreadcrumbList ile sonuçlarda URL yerine yol gösterilir.',
  VideoObject: 'Gömülü video tespit edildi. VideoObject ile video küçük resmi sonuçlarda ve Video sekmesinde görünebilir.',
};

function templates(hostname) {
  const origin = `https://${hostname}`;
  return {
    org_missing: {
      title: 'Ana sayfada Organization / LocalBusiness yok',
      text: 'Google bilgi paneli, logo ve marka bilgisi için ana sayfada kuruluş işaretlemesi önerilir.',
      code: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Marka Adı', url: `${origin}/`, logo: `${origin}/logo.png`, sameAs: ['https://www.instagram.com/...', 'https://www.linkedin.com/company/...'] }, null, 2),
    },
    website_missing: {
      title: 'Ana sayfada WebSite işaretlemesi yok',
      text: 'WebSite türü, Google’ın site adını doğru göstermesine yardımcı olur.',
      code: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Marka Adı', url: `${origin}/` }, null, 2),
    },
    breadcrumb_sparse: {
      title: 'Derin sayfaların çoğunda BreadcrumbList yok',
      text: 'Kategori/alt sayfalarda breadcrumb işaretlemesi, arama sonucunda site hiyerarşisini gösterir.',
      code: JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${origin}/` }, { '@type': 'ListItem', position: 2, name: 'Kategori', item: `${origin}/kategori/` }, { '@type': 'ListItem', position: 3, name: 'Sayfa Başlığı' }] }, null, 2),
    },
  };
}

function CodeBlock({ code }) {
  const toast = useToast();
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{ margin: 0, padding: 12, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, overflowX: 'auto', maxHeight: 260 }}>
        {`<script type="application/ld+json">\n${code}\n</script>`}
      </pre>
      <button
        className="btn btn-secondary btn-sm" style={{ position: 'absolute', top: 8, right: 8 }}
        onClick={() => navigator.clipboard.writeText(`<script type="application/ld+json">\n${code}\n</script>`).then(() => toast.success('Kopyalandı'), () => toast.error('Kopyalanamadı'))}
      >
        <Copy size={13} /> Kopyala
      </button>
    </div>
  );
}

/** Yapısal veri: tür bazlı geçerlilik (Google zorunlu/önerilen alanları), hatalar, işaretlenmemiş içerik fırsatları. */
export default function SchemaView({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'schema'], queryFn: () => insightApi.schema(domain.id) });
  const [openPage, setOpenPage] = useState(null);
  const [openHint, setOpenHint] = useState(null);
  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (data.needsAudit) return <NoAuditState domain={domain} />;
  if (data.needsRecrawl) return <RecrawlState domain={domain} />;

  const s = data.summary;
  const tpl = templates(domain.hostname);
  return (
    <div className="stack">
      <Tiles items={[
        { label: 'Kapsama', value: fmt.pct(s.coverage), icon: Binary, foot: `${fmt.num(s.withSchema)} / ${fmt.num(s.pages)} sayfada yapısal veri` },
        { label: 'Hatalı sayfa', value: fmt.num(s.pagesWithErrors), icon: CircleX, tone: s.pagesWithErrors ? 'critical' : undefined, foot: 'zengin sonuca uygun değil' },
        { label: 'Eksik önerilen alan', value: fmt.num(s.pagesWithWarnings), icon: TriangleAlert, tone: s.pagesWithWarnings ? 'warning' : undefined, foot: 'sayfa (hatasız)' },
        { label: 'İşaretlenmemiş içerik', value: fmt.num(s.opportunities), icon: Lightbulb, tone: 'good', foot: 'yapısal veri fırsatı' },
      ]} />

      {data.site.map((x) => tpl[x.code] && (
        <div key={x.code} className="card card-pad" style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}><TriangleAlert size={17} style={{ color: 'var(--warning-ink)' }} /><h3>{tpl[x.code].title}</h3>{x.pages && <span className="badge badge-neutral">{x.pages}/{x.total} sayfa</span>}</div>
          <p className="text-2" style={{ fontSize: 13 }}>{tpl[x.code].text} Örnek (kendi bilgilerinizle düzenleyin):</p>
          <CodeBlock code={tpl[x.code].code} />
        </div>
      ))}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Türler</h3><span className="badge badge-neutral">{data.types.length}</span></div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            {data.types.length ? (
              <table className="table">
                <thead><tr><th>Tür</th><th className="r">Sayfa</th><th className="r">Geçerli</th><th className="r">Hatalı</th><th className="r">Eksik alan</th></tr></thead>
                <tbody>
                  {data.types.map((t) => (
                    <tr key={t.type}>
                      <td className="cell-main">{t.type}</td>
                      <td className="r">{fmt.num(t.pages)}</td>
                      <td className="r"><span className="badge badge-good">{fmt.num(t.valid)}</span></td>
                      <td className="r">{t.withErrors ? <span className="badge badge-critical">{fmt.num(t.withErrors)}</span> : <span className="muted">0</span>}</td>
                      <td className="r">{t.withWarnings ? <span className="badge badge-warning">{fmt.num(t.withWarnings)}</span> : <span className="muted">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState icon={Binary} title="Doğrulanabilir yapısal veri yok">Sitede Google zengin sonuç türlerinden hiçbiri işaretlenmemiş.</EmptyState>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>En sık sorunlar</h3><span className="badge badge-neutral">{data.messages.length}</span></div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
            {data.messages.length ? (
              <table className="table">
                <thead><tr><th>Sorun</th><th className="r">Sayfa</th></tr></thead>
                <tbody>
                  {data.messages.map((m) => (
                    <tr key={m.message}>
                      <td>
                        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          {m.kind === 'error' ? <CircleX size={14} style={{ color: 'var(--critical)', flex: 'none' }} /> : <TriangleAlert size={14} style={{ color: 'var(--warning)', flex: 'none' }} />}
                          {m.message}
                        </span>
                      </td>
                      <td className="r">{fmt.num(m.pages)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState icon={CircleCheck} title="Sorun yok" />}
          </div>
        </div>
      </div>

      {data.opportunities.length > 0 && (
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><Lightbulb size={17} /> İşaretlenmemiş içerik</h3></div>
          <Tip>Sayfa içeriğinde bu türlere uygun yapı tespit edildi ama ilgili JSON-LD yok. İşaretlemek, zengin sonuç ve daha iyi anlaşılma sağlar.</Tip>
          <div style={{ marginTop: 10 }}>
            {data.opportunities.map((o) => (
              <div key={o.type} className="issue">
                <button className="issue-head" onClick={() => setOpenHint(openHint === o.type ? null : o.type)} aria-expanded={openHint === o.type}>
                  {openHint === o.type ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="issue-title">{o.type}</span>
                  <span className="badge badge-neutral">{fmt.num(o.count)} sayfa</span>
                </button>
                {openHint === o.type && (
                  <div className="issue-body">
                    <p className="text-2" style={{ fontSize: 13 }}>{HINT_INFO[o.type]}</p>
                    <div className="url-list">
                      {o.pages.map((p) => (
                        <div key={p.url}>
                          <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="truncate" title={p.url}>{shortUrl(p.url)}</a>
                          <span className="muted truncate" style={{ maxWidth: 280 }}>{p.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Sorunlu sayfalar</h3><span className="badge badge-neutral">{data.pages.length}</span></div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {data.pages.length ? (
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>Sayfa</th><th className="r">Hata</th><th className="r">Eksik alan</th><th className="r">Test</th></tr></thead>
              <tbody>
                {data.pages.map((p) => (
                  <Fragment key={p.url}>
                    <tr className="clickable" onClick={() => setOpenPage(openPage === p.url ? null : p.url)} aria-expanded={openPage === p.url}>
                      <td>{openPage === p.url ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td><PageLink url={p.url} title={p.title} max={420} /></td>
                      <td className="r">{p.errors ? <span className="badge badge-critical">{p.errors}</span> : <span className="muted">0</span>}</td>
                      <td className="r">{p.warnings ? <span className="badge badge-warning">{p.warnings}</span> : <span className="muted">0</span>}</td>
                      <td className="r">
                        <a className="btn btn-ghost btn-sm" href={richTest(p.url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Google Zengin Sonuçlar Testi">
                          <ExternalLink size={14} /> Google
                        </a>
                      </td>
                    </tr>
                    {openPage === p.url && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--surface-2)' }}>
                          <div style={{ display: 'grid', gap: 8, padding: '4px 4px 8px' }}>
                            {p.items.map((it, i) => (
                              <div key={`${it.type}${i}`}>
                                <strong>{it.type}</strong>
                                <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
                                  {it.errors.map((e) => <li key={e} style={{ color: 'var(--critical-ink)' }}>{e}</li>)}
                                  {it.warnings.map((w) => <li key={w} className="text-2">{w}</li>)}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={CircleCheck} title="Sorunlu sayfa yok">Doğrulanan tüm yapısal veriler Google’ın zorunlu ve önerilen alanlarını karşılıyor.</EmptyState>}
        </div>
      </div>
    </div>
  );
}
