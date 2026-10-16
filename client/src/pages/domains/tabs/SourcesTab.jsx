import { useQuery } from '@tanstack/react-query';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { domainApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Delta, Skeleton } from '../../../components/ui/Feedback';
import { DEVICE_LABELS, countryName, fmt, relativeChange } from '../../../utils/format';

const DEVICE_ICONS = { MOBILE: Smartphone, DESKTOP: Monitor, TABLET: Tablet };

function ShareBar({ value, max }) {
  return (
    <div className="bar-cell">
      <div className="bar-track"><div className="bar-fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
    </div>
  );
}

export default function SourcesTab({ domain, days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['gsc', domain.id, 'breakdown', days],
    queryFn: () => domainApi.breakdown(domain.id, { days }),
  });
  const devices = data?.devices || [];
  const countries = data?.countries || [];
  const totalClicks = devices.reduce((a, d) => a + d.clicks, 0);
  const maxCountry = countries[0]?.clicks || 0;

  return (
    <div className="stack">
      <div className="grid grid-3">
        {isLoading
          ? [0, 1, 2].map((i) => <div key={i} className="card card-pad"><Skeleton height={90} /></div>)
          : devices.map((d) => {
              const Icon = DEVICE_ICONS[d.key] || Monitor;
              const share = totalClicks ? d.clicks / totalClicks : 0;
              return (
                <div key={d.key} className="card stat">
                  <span className="stat-label"><span className="stat-icon"><Icon size={16} /></span>{DEVICE_LABELS[d.key] || d.key}</span>
                  <span className="stat-value num">{fmt.num(d.clicks)} <small className="muted" style={{ fontSize: 14, fontWeight: 500 }}>tıklama</small></span>
                  <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${share * 100}%` }} /></div>
                  <span className="stat-foot">
                    Payı {fmt.pct(share)} · TO {fmt.pct(d.ctr)} · Poz. {fmt.pos(d.position)} · <Delta value={relativeChange(d.clicks, d.prev_clicks)} />
                  </span>
                </div>
              );
            })}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Ülkelere göre organik trafik</h3>
            <p>Tıklamaların hangi ülkelerden geldiği</p>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Ülke</th><th>Pay</th><th className="r">Tıklama</th><th className="r">Değişim</th>
                <th className="r">Gösterim</th><th className="r">TO</th><th className="r">Poz.</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={7}><Skeleton height={14} /></td></tr>)
                : countries.map((c) => (
                    <tr key={c.key}>
                      <td className="cell-main">{countryName(c.key)}</td>
                      <td style={{ width: '22%' }}><ShareBar value={c.clicks} max={maxCountry} /></td>
                      <td className="r">{fmt.num(c.clicks)}</td>
                      <td className="r"><Delta value={relativeChange(c.clicks, c.prev_clicks)} /></td>
                      <td className="r">{fmt.num(c.impressions)}</td>
                      <td className="r">{fmt.pct(c.ctr)}</td>
                      <td className="r"><PositionPill value={c.position} /></td>
                    </tr>
                  ))}
              {!isLoading && !countries.length && <tr><td colSpan={7} className="muted">Veri yok</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
