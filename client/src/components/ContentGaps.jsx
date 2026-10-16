import { useQuery } from '@tanstack/react-query';
import { FilePenLine, Lightbulb } from 'lucide-react';
import { domainApi } from '../api/endpoints';
import { fmt, safeHref, shortUrl } from '../utils/format';
import { PositionPill } from './ui/DataTable';
import { EmptyState, Skeleton } from './ui/Feedback';

/** Sayfanın 4–20. sırada çıktığı ama title/H1'de geçmeyen sorgular: en hızlı içerik kazanımları. */
export default function ContentGaps({ domainId }) {
  const { data, isLoading } = useQuery({ queryKey: ['gsc', domainId, 'content-gaps'], queryFn: () => domainApi.contentGaps(domainId) });
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="row" style={{ gap: 8 }}><FilePenLine size={17} /> İçerik boşlukları</h3>
        <span className="badge badge-neutral">{data?.rows?.length ?? 0}</span>
      </div>
      <p className="text-2 row" style={{ padding: '8px 20px 0', fontSize: 12.5, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Lightbulb size={14} style={{ flex: 'none', marginTop: 3, color: 'var(--warning-ink)' }} />
        Sayfa bu sorgularda 4–20. sırada ama sorgu title veya H1’de geçmiyor. Sorguyu title’a, bir H2 başlığına ve ilk paragrafa doğal şekilde eklemek sayfayı ilk 3’e yaklaştırabilir.
      </p>
      <div className="table-wrap" style={{ marginTop: 10, maxHeight: 460, overflowY: 'auto' }}>
        {isLoading ? <div style={{ padding: 20 }}><Skeleton height={120} /></div> : data?.rows?.length ? (
          <table className="table">
            <thead><tr><th>Sorgu</th><th>Sayfa</th><th className="r">Poz.</th><th className="r">Gösterim</th><th className="r">Meta’da</th><th className="r">Potansiyel</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.query}|${r.page}`}>
                  <td className="cell-main truncate" style={{ maxWidth: 260 }}>{r.query}</td>
                  <td style={{ maxWidth: 260 }}>
                    <a href={safeHref(r.page)} target="_blank" rel="noopener noreferrer" className="truncate" style={{ display: 'block' }} title={r.page}>{shortUrl(r.page)}</a>
                    <div className="cell-sub truncate" title={r.title || ''}>{r.title || 'Title yok'}</div>
                  </td>
                  <td className="r"><PositionPill value={r.position} /></td>
                  <td className="r">{fmt.num(r.impressions)}</td>
                  <td className="r">{r.inMeta ? <span className="badge badge-good">Var</span> : <span className="badge badge-neutral">Yok</span>}</td>
                  <td className="r"><span className="badge badge-good">+{fmt.num(r.potential)} tık</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={FilePenLine} title={data?.needsAudit ? 'Önce site taraması gerekli' : 'İçerik boşluğu bulunamadı'}>
            {data?.needsAudit ? 'Sayfa başlıklarını karşılaştırabilmek için Site Sağlığı sekmesinden tarama başlatın.' : null}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
