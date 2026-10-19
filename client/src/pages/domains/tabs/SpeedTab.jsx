import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Monitor, Play, Smartphone, Zap } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../../api/client';
import { domainApi } from '../../../api/endpoints';
import { Alert, EmptyState, ScoreRing, Skeleton, Spinner, scoreStatus } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import CruxTrend from '../../../components/CruxTrend';
import { fmt } from '../../../utils/format';

const LAB_METRICS = [
  { key: 'lcp', label: 'Largest Contentful Paint', short: 'LCP' },
  { key: 'tbt', label: 'Total Blocking Time', short: 'TBT' },
  { key: 'cls', label: 'Cumulative Layout Shift', short: 'CLS' },
  { key: 'fcp', label: 'First Contentful Paint', short: 'FCP' },
  { key: 'si', label: 'Speed Index', short: 'SI' },
  { key: 'ttfb', label: 'Sunucu yanıt süresi', short: 'TTFB' },
];
const FIELD = [
  { key: 'lcp', label: 'LCP', format: (v) => fmt.ms(v) },
  { key: 'inp', label: 'INP', format: (v) => fmt.ms(v) },
  { key: 'cls', label: 'CLS', format: (v) => (v / 100).toFixed(2) },
  { key: 'fcp', label: 'FCP', format: (v) => fmt.ms(v) },
  { key: 'ttfb', label: 'TTFB', format: (v) => fmt.ms(v) },
];
const CATEGORY = { FAST: ['good', 'İyi'], AVERAGE: ['warning', 'Geliştirilmeli'], SLOW: ['critical', 'Zayıf'] };

function Report({ r }) {
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="grid grid-4" style={{ justifyItems: 'center', textAlign: 'center' }}>
          {[['performance', 'Performans'], ['accessibility', 'Erişilebilirlik'], ['best_practices', 'En iyi uygulamalar'], ['seo', 'SEO']].map(([k, l]) => (
            <div key={k} style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
              <ScoreRing score={r[k]} size={96} stroke={8} label={scoreStatus(r[k]).label} />
              <strong style={{ fontSize: 13.5 }}>{l}</strong>
            </div>
          ))}
        </div>
        <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}>{r.url} · {fmt.dateTime(r.created_at)}</p>
      </div>

      {r.field_data && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Gerçek kullanıcı verisi (CrUX · 28 gün)</h3>
              <p>Google’ın sıralamada kullandığı Core Web Vitals değerleri (75. yüzdelik)</p>
            </div>
            {r.field_data.overall && (
              <span className={`badge badge-${CATEGORY[r.field_data.overall]?.[0] || 'neutral'}`}>
                Genel: {CATEGORY[r.field_data.overall]?.[1] || r.field_data.overall}
              </span>
            )}
          </div>
          <div className="card-body grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {FIELD.filter((f) => r.field_data.metrics?.[f.key]).map((f) => {
              const m = r.field_data.metrics[f.key];
              const [cls, label] = CATEGORY[m.category] || ['neutral', m.category];
              return (
                <div key={f.key} className="metric-tile">
                  <small>{f.label}</small>
                  <strong className="num">{f.format(m.p75)}</strong>
                  <span className={`badge badge-${cls}`} style={{ justifySelf: 'start' }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><div><h3>Laboratuvar metrikleri</h3><p>Lighthouse simülasyonu</p></div></div>
        <div className="card-body grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {LAB_METRICS.filter((m) => r.metrics?.[m.key]).map((m) => {
            const v = r.metrics[m.key];
            const s = scoreStatus(v.score);
            return (
              <div key={m.key} className="metric-tile">
                <small>{m.label}</small>
                <strong className="num">{v.display || '—'}</strong>
                <span className={`badge badge-${s.cls}`} style={{ justifySelf: 'start' }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {[['opportunities', 'İyileştirme fırsatları', 'Uygulandığında sayfa yükleme süresini kısaltacak adımlar'], ['diagnostics', 'Teşhisler', 'Performansı etkileyen diğer bulgular']].map(([key, title, sub]) =>
        r[key]?.length ? (
          <div key={key} className="card">
            <div className="card-head" style={{ paddingBottom: 12 }}><div><h3>{title}</h3><p>{sub}</p></div></div>
            {r[key].map((o) => (
              <div key={o.id} className="issue" style={{ padding: '14px 20px', display: 'grid', gap: 6, borderTop: '1px solid var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontWeight: 500 }}>{o.title}</strong>
                  <span className="row" style={{ gap: 6 }}>
                    {o.savingsMs > 0 && <span className="badge badge-warning"><Zap size={12} /> ~{fmt.ms(o.savingsMs)} kazanç</span>}
                    {o.savingsBytes > 0 && <span className="badge badge-neutral">{fmt.bytes(o.savingsBytes)}</span>}
                    {o.displayValue && !o.savingsMs && <span className="badge badge-neutral">{o.displayValue}</span>}
                  </span>
                </div>
                <p className="text-2" style={{ fontSize: 13 }}>{o.description}</p>
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

export default function SpeedTab({ domain }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [strategy, setStrategy] = useState('mobile');
  const { data, isLoading } = useQuery({
    queryKey: ['psi', id],
    queryFn: () => domainApi.pagespeed(id),
    refetchInterval: (q) => (q.state.data?.mobile?.status === 'running' || q.state.data?.desktop?.status === 'running' ? 4000 : false),
  });
  const run = useMutation({
    mutationFn: (s) => domainApi.runPagespeed(id, { strategy: s }),
    onSuccess: () => {
      toast.success('PageSpeed testi başladı (~30 sn)');
      qc.invalidateQueries({ queryKey: ['psi', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Skeleton height={320} />;
  const report = data?.[strategy];
  const running = report?.status === 'running';

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="segmented">
          <button className={strategy === 'mobile' ? 'active' : ''} onClick={() => setStrategy('mobile')}><Smartphone size={14} style={{ verticalAlign: -2 }} /> Mobil</button>
          <button className={strategy === 'desktop' ? 'active' : ''} onClick={() => setStrategy('desktop')}><Monitor size={14} style={{ verticalAlign: -2 }} /> Masaüstü</button>
        </div>
        <button className="btn btn-primary" onClick={() => run.mutate(strategy)} disabled={running || run.isPending}>
          {running ? <><Spinner size={15} /> Test ediliyor…</> : <><Play size={16} /> {report ? 'Testi yenile' : 'Testi başlat'}</>}
        </button>
      </div>

      {!report ? (
        <div className="card">
          <EmptyState icon={Gauge} title={`${strategy === 'mobile' ? 'Mobil' : 'Masaüstü'} hız testi yapılmadı`}>
            Google PageSpeed Insights ile Core Web Vitals, performans, erişilebilirlik ve SEO puanlarını ölçün.
          </EmptyState>
        </div>
      ) : running ? (
        <div className="card"><EmptyState icon={Gauge} title="Test çalışıyor">Lighthouse sayfayı yüklüyor ve analiz ediyor…</EmptyState></div>
      ) : report.status === 'failed' ? (
        <Alert type="error">Test başarısız: {report.error}</Alert>
      ) : (
        <Report r={report} />
      )}
      <CruxTrend domain={domain} />
    </div>
  );
}
