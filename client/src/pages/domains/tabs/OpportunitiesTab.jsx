import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Gauge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { domainApi } from '../../../api/endpoints';
import OpportunityLists from '../../../components/OpportunityLists';
import { SeverityBadge, Skeleton } from '../../../components/ui/Feedback';
import { fmt } from '../../../utils/format';
import SiteOpportunities from '../site/SiteOpportunities';
import ContentGaps from '../../../components/ContentGaps';

/** Anahtar kelime fırsatları (Search Console veya site analizi) + sitedeki en önemli teknik/hız aksiyonları tek ekranda. */
export default function OpportunitiesTab({ domain, days, source = 'gsc' }) {
  const id = domain.id;
  const opp = useQuery({ queryKey: ['gsc', id, 'opportunities', days], queryFn: () => domainApi.opportunities(id, { days }), enabled: source === 'gsc' });
  const audit = useQuery({ queryKey: ['audit', id], queryFn: () => domainApi.latestAudit(id) });
  const psi = useQuery({ queryKey: ['psi', id], queryFn: () => domainApi.pagespeed(id) });

  const topIssues = (audit.data?.issues || []).filter((i) => i.severity !== 'notice').slice(0, 6);
  const topSpeed = (psi.data?.mobile?.opportunities || []).slice(0, 5);

  return (
    <div className="stack">
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h3 className="row" style={{ gap: 8 }}><AlertCircle size={17} /> Öncelikli teknik düzeltmeler</h3>
            <Link to={`/domains/${id}/health`} className="btn btn-ghost btn-sm">Rapor</Link>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {audit.isLoading ? <Skeleton height={120} /> : topIssues.length ? topIssues.map((i) => (
              <div key={i.code} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <SeverityBadge severity={i.severity} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{i.title} <span className="muted num">({i.siteLevel ? 'site geneli' : `${i.pages} sayfa`})</span></div>
                  <div className="text-2" style={{ fontSize: 12.5 }}>{i.fix}</div>
                </div>
              </div>
            )) : <p className="muted">Kritik veya uyarı seviyesinde sorun yok ya da henüz tarama yapılmadı.</p>}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3 className="row" style={{ gap: 8 }}><Gauge size={17} /> Hız iyileştirmeleri (mobil)</h3>
            <Link to={`/domains/${id}/speed`} className="btn btn-ghost btn-sm">Rapor</Link>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {psi.isLoading ? <Skeleton height={120} /> : topSpeed.length ? topSpeed.map((o) => (
              <div key={o.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span style={{ fontWeight: 500 }}>{o.title}</span>
                {o.savingsMs > 0 && <span className="badge badge-warning" style={{ flex: 'none' }}>~{fmt.ms(o.savingsMs)}</span>}
              </div>
            )) : <p className="muted">Henüz mobil PageSpeed testi yapılmadı veya fırsat bulunamadı.</p>}
          </div>
        </div>
      </div>
      {source === 'site' ? <SiteOpportunities domain={domain} /> : (
        <>
          <ContentGaps domainId={id} />
          {opp.isLoading ? <Skeleton height={300} /> : <OpportunityLists data={opp.data} />}
        </>
      )}
    </div>
  );
}
