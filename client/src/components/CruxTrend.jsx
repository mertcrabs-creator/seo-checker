import { useQuery } from '@tanstack/react-query';
import { Activity, KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorMessage } from '../api/client';
import { insightApi } from '../api/endpoints';
import { fmt } from '../utils/format';
import { Alert, Delta, EmptyState, Skeleton } from './ui/Feedback';

const METRICS = {
  lcp: { label: 'LCP', name: 'En büyük içerik boyaması', unit: 'ms', good: 2500, poor: 4000 },
  inp: { label: 'INP', name: 'Etkileşimden sonraki boyama', unit: 'ms', good: 200, poor: 500 },
  cls: { label: 'CLS', name: 'Kümülatif düzen kayması', unit: '', good: 0.1, poor: 0.25 },
  fcp: { label: 'FCP', name: 'İlk içerik boyaması', unit: 'ms', good: 1800, poor: 3000 },
  ttfb: { label: 'TTFB', name: 'İlk bayta kadar geçen süre', unit: 'ms', good: 800, poor: 1800 },
};
const RATING = { good: { label: 'İyi', cls: 'badge-good' }, ni: { label: 'Geliştirilmeli', cls: 'badge-warning' }, poor: { label: 'Zayıf', cls: 'badge-critical' } };
const fmtVal = (k, v) => (v === null || v === undefined ? '—' : METRICS[k].unit === 'ms' ? fmt.ms(v) : Number(v).toFixed(2));
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 };

/** Gerçek kullanıcı Core Web Vitals trendi (CrUX History API, 28 günlük kayan pencereler) ve aynı dönemlerin tıklamaları. */
export default function CruxTrend({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'crux'], queryFn: () => insightApi.crux(domain.id), staleTime: 30 * 60_000 });
  const [device, setDevice] = useState('phone');
  const [metric, setMetric] = useState('lcp');
  const dev = data?.devices?.[device];
  const series = useMemo(() => (dev?.series || []).filter((s) => s[metric] !== null), [dev, metric]);
  const clicks = useMemo(() => (data?.clicks || []).filter((c) => c.clicks !== null), [data]);

  if (isLoading) return <Skeleton height={260} />;
  if (isError) return <Alert type="error">Core Web Vitals geçmişi alınamadı: {errorMessage(error)}</Alert>;
  if (data.disabled) {
    return (
      <div className="card">
        <EmptyState icon={KeyRound} title="Core Web Vitals geçmişi için API anahtarı gerekli">
          Ücretsizdir: Google Cloud Console’da OAuth için kullandığınız projede <strong>API’ler ve Hizmetler → Kitaplık</strong> bölümünden
          “Chrome UX Report API”yi etkinleştirin, <strong>Kimlik bilgileri → API anahtarı oluştur</strong> ile anahtar alıp sunucudaki
          <code> .env</code> dosyasına <code>CRUX_API_KEY=</code> olarak ekleyin ve sunucuyu yeniden başlatın.
        </EmptyState>
      </div>
    );
  }
  const m = METRICS[metric];
  const summary = dev?.summary;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="row" style={{ gap: 8 }}><Activity size={17} /> Gerçek kullanıcı Core Web Vitals trendi</h3>
          <p>Chrome kullanıcılarından (CrUX) 28 günlük pencereler, 75. yüzdelik · {data.origin}</p>
        </div>
        <div className="row">
          <div className="segmented" role="tablist" aria-label="Cihaz">
            {[['phone', 'Mobil'], ['desktop', 'Masaüstü']].map(([k, l]) => <button key={k} className={device === k ? 'active' : ''} onClick={() => setDevice(k)} role="tab" aria-selected={device === k}>{l}</button>)}
          </div>
        </div>
      </div>
      {dev?.error ? (
        <div className="card-body">
          <EmptyState icon={Activity} title="Bu cihazda yeterli gerçek kullanıcı verisi yok">
            {dev.error === 'no_data' ? 'Site, Chrome kullanıcı raporuna girecek kadar ziyaret almıyor (Google gizlilik eşiği). Laboratuvar testleri yukarıda.' : dev.error}
          </EmptyState>
        </div>
      ) : (
        <div className="card-body" style={{ display: 'grid', gap: 16 }}>
          {summary && (
            <div className="grid grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <div className="metric-tile">
                <small>Core Web Vitals</small>
                <strong>{summary.passes === null ? '—' : summary.passes ? 'Geçiyor' : 'Geçmiyor'}</strong>
                <small>{fmt.dateShort(summary.date)} itibarıyla</small>
              </div>
              {Object.keys(METRICS).map((k) => (
                <button
                  key={k} type="button" className="metric-tile" onClick={() => setMetric(k)}
                  style={{ textAlign: 'left', cursor: 'pointer', borderColor: metric === k ? 'var(--primary)' : undefined }} aria-pressed={metric === k}
                >
                  <small>{METRICS[k].label} · {METRICS[k].name}</small>
                  <strong className="num">{fmtVal(k, summary[k]?.p75)}</strong>
                  <span className="row" style={{ gap: 6 }}>
                    {summary[k]?.rating && <span className={`badge ${RATING[summary[k].rating].cls}`}>{RATING[summary[k].rating].label}</span>}
                    {summary[k]?.change !== null && summary[k]?.change !== undefined && <Delta value={summary[k].change} invert />}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div>
            <div className="hint" style={{ marginBottom: 6 }}>{m.label} (p75) · yeşil çizgi “iyi”, kırmızı çizgi “zayıf” eşiği · değişim ~2 aya göre</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} syncId="crux">
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickFormatter={fmt.dateShort} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} minTickGap={28} tickMargin={6} />
                <YAxis tickFormatter={(v) => fmtVal(metric, v)} tickLine={false} axisLine={false} width={56} domain={[0, (max) => Math.max(max, m.poor) * 1.05]} />
                <Tooltip labelFormatter={(l) => `${fmt.dateShort(l)} ile biten 28 gün`} formatter={(v) => [fmtVal(metric, v), m.label]} contentStyle={tooltipStyle} />
                <ReferenceLine y={m.good} stroke="var(--good)" strokeDasharray="4 4" />
                <ReferenceLine y={m.poor} stroke="var(--critical)" strokeDasharray="4 4" />
                <Line dataKey={metric} stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {clicks.length > 2 && (
            <div>
              <div className="hint" style={{ marginBottom: 6 }}>Aynı 28 günlük pencerelerde organik tıklama (hız değişiminin trafiğe etkisini görmek için)</div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={clicks} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} syncId="crux">
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tickFormatter={fmt.dateShort} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} minTickGap={28} tickMargin={6} />
                  <YAxis tickFormatter={fmt.compact} tickLine={false} axisLine={false} width={56} />
                  <Tooltip labelFormatter={(l) => `${fmt.dateShort(l)} ile biten 28 gün`} formatter={(v) => [fmt.num(v), 'Tıklama']} contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-hover)' }} />
                  <Bar dataKey="clicks" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
