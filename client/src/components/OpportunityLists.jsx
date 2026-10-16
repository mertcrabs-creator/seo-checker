import { Lightbulb, MousePointerClick, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { PositionPill } from './ui/DataTable';
import { Delta, EmptyState } from './ui/Feedback';
import { fmt, relativeChange } from '../utils/format';

const SECTIONS = [
  {
    key: 'strikingDistance', icon: Target, title: 'Vuruş mesafesindeki kelimeler',
    tip: '4–20. sıradaki, yüksek gösterimli kelimeler. İçeriği genişletmek, title’a kelimeyi eklemek ve iç bağlantı vermek ilk 3’e taşıyabilir.',
    extra: { label: 'Potansiyel', render: (r) => <span className="badge badge-good">+{fmt.num(r.potentialClicks)} tık</span> },
  },
  {
    key: 'lowCtr', icon: MousePointerClick, title: 'Düşük tıklama oranı',
    tip: 'İlk sayfadasınız ama beklenen tıklamayı alamıyorsunuz. Title ve meta açıklamayı daha çekici yazın, yapısal veri ile zengin sonuç kazanın.',
    extra: { label: 'TO / Beklenen', render: (r) => <span className="num">{fmt.pct(r.ctr)} / {fmt.pct(r.expectedCtr)}</span> },
  },
  {
    key: 'declining', icon: TrendingDown, title: 'Trafik kaybeden kelimeler',
    tip: 'Önceki döneme göre tıklaması düşen kelimeler. İçerik güncelliğini, rakip sayfaları ve teknik sorunları kontrol edin.',
    extra: { label: 'Tıklama değişimi', render: (r) => <Delta value={relativeChange(r.clicks, r.prev_clicks)} /> },
  },
  {
    key: 'rising', icon: TrendingUp, title: 'Yükselen kelimeler',
    tip: 'Momentum kazanan kelimeler. Bu konularda destekleyici içerikler üreterek konu otoritesini güçlendirin.',
    extra: { label: 'Tıklama değişimi', render: (r) => <Delta value={relativeChange(r.clicks, r.prev_clicks)} /> },
  },
];

export default function OpportunityLists({ data, showDomain }) {
  return (
    <div className="grid grid-2">
      {SECTIONS.map(({ key, icon: Icon, title, tip, extra }) => {
        const rows = data?.[key] || [];
        return (
          <div key={key} className="card">
            <div className="card-head">
              <h3 className="row" style={{ gap: 8 }}><Icon size={17} /> {title}</h3>
              <span className="badge badge-neutral">{rows.length}</span>
            </div>
            <p className="text-2 row" style={{ padding: '8px 20px 0', fontSize: 12.5, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <Lightbulb size={14} style={{ flex: 'none', marginTop: 3, color: 'var(--warning-ink)' }} /> {tip}
            </p>
            <div className="table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
              {rows.length ? (
                <table className="table">
                  <thead><tr><th>Anahtar kelime</th><th className="r">Poz.</th><th className="r">Gösterim</th><th className="r">{extra.label}</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.domain_id}|${r.query}`}>
                        <td>
                          <div className="cell-main truncate" style={{ maxWidth: 260 }}>{r.query}</div>
                          {showDomain && <div className="cell-sub">{r.hostname}</div>}
                        </td>
                        <td className="r"><PositionPill value={r.position} /></td>
                        <td className="r">{fmt.num(r.impressions)}</td>
                        <td className="r">{extra.render(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState icon={Icon} title="Kayıt yok" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
