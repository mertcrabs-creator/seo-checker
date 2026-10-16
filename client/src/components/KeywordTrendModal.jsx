import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { domainApi } from '../api/endpoints';
import TrendChart, { METRICS } from './charts/TrendChart';
import { PositionPill } from './ui/DataTable';
import { Modal, Skeleton } from './ui/Feedback';
import { fmt, safeHref, shortUrl } from '../utils/format';
import KeywordCountryRanks from './KeywordCountryRanks';

/** Tek anahtar kelimenin günlük trendi ve sıralanan URL'leri. */
export default function KeywordTrendModal({ domainId, keyword, days, onClose }) {
  const [metric, setMetric] = useState('position');
  const { data, isLoading } = useQuery({
    queryKey: ['gsc', domainId, 'trend', keyword, days],
    queryFn: () => domainApi.keywordTrend(domainId, { query: keyword, days }),
  });

  return (
    <Modal title={`“${keyword}”`} onClose={onClose} width={980}>
      <div className="segmented" style={{ justifySelf: 'start' }}>
        {['position', 'clicks', 'impressions'].map((k) => (
          <button key={k} className={metric === k ? 'active' : ''} onClick={() => setMetric(k)}>{METRICS[k].label}</button>
        ))}
      </div>
      {isLoading ? <Skeleton height={240} /> : <TrendChart data={data.daily} metric={metric} height={240} />}
      <KeywordCountryRanks domainId={domainId} keyword={keyword} />
      <div>
        <h4 style={{ fontSize: 14, marginBottom: 8 }}>Bu kelimede sıralanan sayfalar (son 28 gün)</h4>
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Sayfa</th><th className="r">Tıklama</th><th className="r">Gösterim</th><th className="r">Poz.</th></tr></thead>
            <tbody>
              {(data?.pages || []).map((p) => (
                <tr key={p.page}>
                  <td className="truncate" style={{ maxWidth: 380 }}>
                    <a href={safeHref(p.page)} target="_blank" rel="noopener noreferrer" title={p.page}>{shortUrl(p.page)}</a>
                  </td>
                  <td className="r">{fmt.num(p.clicks)}</td>
                  <td className="r">{fmt.num(p.impressions)}</td>
                  <td className="r"><PositionPill value={p.position} /></td>
                </tr>
              ))}
              {!isLoading && !data?.pages?.length && <tr><td colSpan={4} className="muted">Veri yok</td></tr>}
            </tbody>
          </table>
        </div>
        {data?.pages?.length > 1 && (
          <p className="hint" style={{ marginTop: 8 }}>
            Birden fazla sayfa aynı kelimede sıralanıyor — olası anahtar kelime yamyamlığı (cannibalization). Ana sayfayı belirleyip diğerlerinden iç bağlantı verin veya içerikleri birleştirin.
          </p>
        )}
      </div>
    </Modal>
  );
}
