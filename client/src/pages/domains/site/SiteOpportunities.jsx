import { useQuery } from '@tanstack/react-query';
import { FileWarning, Layers, Lightbulb, Link2Off, Star, Target, Unlink } from 'lucide-react';
import { domainApi } from '../../../api/endpoints';
import { EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { Flag, NoAuditState, ScorePill } from './shared';

const PageLink = ({ url, title }) => (
  <div style={{ minWidth: 0 }}>
    <a href={safeHref(url)} target="_blank" rel="noopener noreferrer" className="cell-main truncate" style={{ display: 'block', maxWidth: 300 }} title={url}>{shortUrl(url)}</a>
    {title && <div className="cell-sub truncate" style={{ maxWidth: 300 }}>{title}</div>}
  </div>
);

function Section({ icon: Icon, title, tip, count, children }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="row" style={{ gap: 8 }}><Icon size={17} /> {title}</h3>
        <span className="badge badge-neutral">{count}</span>
      </div>
      <p className="text-2 row" style={{ padding: '8px 20px 0', fontSize: 12.5, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Lightbulb size={14} style={{ flex: 'none', marginTop: 3, color: 'var(--warning-ink)' }} /> {tip}
      </p>
      <div className="table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
        {count ? children : <EmptyState icon={Icon} title="Kayıt yok" />}
      </div>
    </div>
  );
}

/** Taramadan üretilen içerik, anahtar kelime ve iç bağlantı fırsatları. */
export default function SiteOpportunities({ domain }) {
  const { data, isLoading } = useQuery({
    queryKey: ['site', domain.id, 'opportunities'],
    queryFn: () => domainApi.siteOpportunities(domain.id),
  });
  if (isLoading) return <Skeleton height={300} />;
  if (!data?.audit) return <NoAuditState domain={domain} />;

  return (
    <div className="grid grid-2">
      <Section
        icon={Layers} title="Anahtar kelime yamyamlığı" count={data.cannibalization.length}
        tip="Aynı kelimeyi title ve H1’de hedefleyen birden fazla sayfa. Birini ana sayfa seçin, diğerlerini farklı kelimelere yönlendirin veya birleştirin."
      >
        <table className="table">
          <thead><tr><th>Kelime</th><th>Yarışan sayfalar</th></tr></thead>
          <tbody>
            {data.cannibalization.map((c) => (
              <tr key={c.keyword}>
                <td className="cell-main" style={{ verticalAlign: 'top' }}>{c.keyword}</td>
                <td style={{ display: 'grid', gap: 8 }}>{c.pages.slice(0, 5).map((p) => <PageLink key={p.url} url={p.url} title={p.title} />)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        icon={Target} title="Ana kelime yerleşimi eksik" count={data.keywordPlacement.length}
        tip="Sayfanın ana anahtar kelimesi title, H1 veya meta açıklamada yok. Üçünde de doğal şekilde kullanmak sıralama sinyalini güçlendirir."
      >
        <table className="table">
          <thead><tr><th>Sayfa</th><th>Ana kelime</th><th className="r">Title</th><th className="r">H1</th><th className="r">Meta</th></tr></thead>
          <tbody>
            {data.keywordPlacement.map((p) => (
              <tr key={p.url}>
                <td><PageLink url={p.url} title={p.title} /></td>
                <td className="truncate" style={{ maxWidth: 160 }}>{p.keyword}</td>
                <td className="r"><Flag on={p.in_title} label="Title" /></td>
                <td className="r"><Flag on={p.in_h1} label="H1" /></td>
                <td className="r"><Flag on={p.in_meta} label="Meta açıklama" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        icon={Star} title="Önemli ama sorunlu sayfalar" count={data.importantPages.length}
        tip="Sitede en çok iç bağlantı alan (yani sizin için önemli) ama sayfa içi puanı düşük sayfalar. İlk buradan başlayın."
      >
        <table className="table">
          <thead><tr><th>Sayfa</th><th className="r">Gelen bağ.</th><th className="r">Sorun</th><th className="r">Puan</th></tr></thead>
          <tbody>
            {data.importantPages.map((p) => (
              <tr key={p.url}>
                <td><PageLink url={p.url} title={p.title} /></td>
                <td className="r">{fmt.num(p.inlinks)}</td>
                <td className="r">{fmt.num(p.issue_count)}</td>
                <td className="r"><ScorePill score={p.onpage_score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        icon={FileWarning} title="Yetersiz içerik" count={data.thinContent.length}
        tip="250 kelimenin altındaki indekslenebilir sayfalar. Konuyu genişletin, SSS ekleyin veya benzer sayfalarla birleştirin."
      >
        <table className="table">
          <thead><tr><th>Sayfa</th><th className="r">Kelime</th></tr></thead>
          <tbody>
            {data.thinContent.map((p) => (
              <tr key={p.url}><td><PageLink url={p.url} title={p.title} /></td><td className="r">{fmt.num(p.word_count)}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        icon={Unlink} title="Yetim sayfalar" count={data.orphans.length}
        tip="Site haritasında olan ama hiçbir sayfadan bağlantı almayan sayfalar. İlgili sayfalardan açıklayıcı anchor text ile bağlantı verin."
      >
        <table className="table">
          <thead><tr><th>Sayfa</th><th className="r">Kelime</th></tr></thead>
          <tbody>
            {data.orphans.map((p) => (
              <tr key={p.url}><td><PageLink url={p.url} title={p.title} /></td><td className="r">{fmt.num(p.word_count)}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        icon={Link2Off} title="Az iç bağlantı alan içerikler" count={data.weakLinks.length}
        tip="En fazla 1 iç bağlantı alan sayfalar. İç bağlantı, sayfanın önemini arama motoruna anlatmanın en ucuz yoludur."
      >
        <table className="table">
          <thead><tr><th>Sayfa</th><th className="r">Gelen bağ.</th><th className="r">Kelime</th></tr></thead>
          <tbody>
            {data.weakLinks.map((p) => (
              <tr key={p.url}>
                <td><PageLink url={p.url} title={p.title} /></td>
                <td className="r">{fmt.num(p.inlinks)}</td>
                <td className="r">{fmt.num(p.word_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
