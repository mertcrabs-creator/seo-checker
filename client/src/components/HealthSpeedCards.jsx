import { useQuery } from '@tanstack/react-query';
import { Activity, Gauge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { domainApi } from '../api/endpoints';
import { ScoreRing } from './ui/Feedback';

/** Site sağlığı ve mobil hız özet kartları (genel bakış ekranlarında ortak). */
export default function HealthSpeedCards({ domainId }) {
  const audit = useQuery({ queryKey: ['audit', domainId], queryFn: () => domainApi.latestAudit(domainId) });
  const psi = useQuery({ queryKey: ['psi', domainId], queryFn: () => domainApi.pagespeed(domainId) });
  return (
    <div className="grid grid-2">
      <div className="card card-pad row" style={{ gap: 20, alignItems: 'center', flexWrap: 'nowrap' }}>
        <ScoreRing score={audit.data?.audit?.score ?? null} label="Sağlık" />
        <div style={{ display: 'grid', gap: 6 }}>
          <h3 className="row" style={{ gap: 8 }}><Activity size={17} /> Site sağlığı</h3>
          {audit.data?.audit?.status === 'completed' ? (
            <p className="text-2">
              {audit.data.summary.critical} kritik, {audit.data.summary.warning} uyarı · {audit.data.audit.pages_crawled} sayfa tarandı
            </p>
          ) : (
            <p className="text-2">Henüz tamamlanmış tarama yok.</p>
          )}
          <Link to={`/domains/${domainId}/health`} className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }}>Rapora git</Link>
        </div>
      </div>
      <div className="card card-pad row" style={{ gap: 20, alignItems: 'center', flexWrap: 'nowrap' }}>
        <ScoreRing score={psi.data?.mobile?.performance ?? null} label="Mobil" />
        <div style={{ display: 'grid', gap: 6 }}>
          <h3 className="row" style={{ gap: 8 }}><Gauge size={17} /> Sayfa hızı</h3>
          <p className="text-2">
            {psi.data?.mobile?.status === 'completed'
              ? `LCP ${psi.data.mobile.metrics?.lcp?.display || '—'} · CLS ${psi.data.mobile.metrics?.cls?.display || '—'}`
              : psi.data?.mobile?.status === 'running' ? 'Mobil hız testi sürüyor…' : 'Henüz PageSpeed testi yapılmadı.'}
          </p>
          <Link to={`/domains/${domainId}/speed`} className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }}>Rapora git</Link>
        </div>
      </div>
    </div>
  );
}
