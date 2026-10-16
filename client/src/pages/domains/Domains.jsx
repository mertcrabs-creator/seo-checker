import { useQuery } from '@tanstack/react-query';
import { Activity, Gauge, Globe, Plus, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { domainApi } from '../../api/endpoints';
import Sparkline from '../../components/charts/Sparkline';
import { Alert, Delta, EmptyState, Skeleton, scoreStatus } from '../../components/ui/Feedback';
import { fmt, relativeChange } from '../../utils/format';
import AddDomainModal from './AddDomainModal';

function ScoreBadge({ icon: Icon, label, score }) {
  const s = scoreStatus(score);
  return (
    <span className={`badge badge-${s.cls}`} title={`${label}: ${s.label}`}>
      <Icon size={13} /> {label} {score ?? '—'}
    </span>
  );
}

function DomainCard({ d, onOpen }) {
  const spark = useMemo(() => (d.spark || []).map((p) => p.clicks), [d.spark]);
  return (
    <article className="card domain-card" onClick={onOpen} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="domain-head">
        <div className="favicon" aria-hidden="true" style={{ fontWeight: 600, color: 'var(--primary)' }}>
          {d.hostname[0].toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="truncate" style={{ fontSize: 15 }}>{d.hostname}</h3>
          <div className="muted truncate" style={{ fontSize: 12 }}>
            {d.gsc_property ? `GSC: ${d.gsc_property}` : 'Site analizi'}
          </div>
        </div>
        {d.gsc_property && <Sparkline values={spark} width={96} height={34} />}
      </div>

      {!d.gsc_property ? (
        <div className="domain-metrics">
          <div className="domain-metric">
            <small>Taranan sayfa</small>
            <strong className="num">{fmt.compact(d.pages_crawled)}</strong>
          </div>
          <div className="domain-metric">
            <small>Tespit edilen kelime</small>
            <strong className="num">{fmt.compact(d.site_keywords)}</strong>
          </div>
          <div className="domain-metric">
            <small>Sayfa içi puan</small>
            <strong className="num">{d.avg_onpage ?? '—'}</strong>
          </div>
        </div>
      ) : (
      <div className="domain-metrics">
        <div className="domain-metric">
          <small>Tıklama (28g)</small>
          <strong className="num">{fmt.compact(d.clicks)}</strong>
          <div><Delta value={relativeChange(d.clicks, d.prev_clicks)} /></div>
        </div>
        <div className="domain-metric">
          <small>Gösterim</small>
          <strong className="num">{fmt.compact(d.impressions)}</strong>
          <div><Delta value={relativeChange(d.impressions, d.prev_impressions)} /></div>
        </div>
        <div className="domain-metric">
          <small>Ort. pozisyon</small>
          <strong className="num">{fmt.pos(d.position)}</strong>
        </div>
      </div>
      )}

      <div className="domain-foot">
        <ScoreBadge icon={Activity} label="Sağlık" score={d.health_score} />
        <ScoreBadge icon={Gauge} label="Mobil hız" score={d.mobile_performance} />
        {['queued', 'running'].includes(d.audit_status) && <span className="badge badge-notice"><RefreshCw size={12} className="spin" /> Taranıyor</span>}
        {d.sync_status === 'running' && (
          <span className="badge badge-notice"><RefreshCw size={12} className="spin" /> Senkronize ediliyor</span>
        )}
        {d.sync_status === 'failed' && <span className="badge badge-critical" title={d.sync_error || ''}>Senkron hatası</span>}
      </div>
    </article>
  );
}

export default function Domains() {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['domains'],
    queryFn: domainApi.list,
    refetchInterval: (q) => (q.state.data?.domains?.some((d) => d.sync_status === 'running' || ['queued', 'running'].includes(d.audit_status)) ? 5000 : false),
  });

  const domains = useMemo(
    () => (data?.domains || []).filter((d) => d.hostname.includes(filter.trim().toLowerCase())),
    [data, filter],
  );
  const totals = useMemo(() => {
    const list = data?.domains || [];
    return {
      clicks: list.reduce((a, d) => a + (d.clicks || 0), 0),
      prevClicks: list.reduce((a, d) => a + (d.prev_clicks || 0), 0),
      impressions: list.reduce((a, d) => a + (d.impressions || 0), 0),
      prevImpressions: list.reduce((a, d) => a + (d.prev_impressions || 0), 0),
    };
  }, [data]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Alan Adları</h1>
          <p>Takip ettiğiniz sitelerin organik performansı ve sağlık durumu.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={17} /> Alan adı ekle
        </button>
      </div>

      {isError && <Alert type="error">{errorMessage(error)}</Alert>}

      {!!data?.domains?.length && (
        <div className="grid grid-3">
          <div className="card stat">
            <span className="stat-label"><span className="stat-icon"><Globe size={16} /></span> Alan adı</span>
            <span className="stat-value num">{data.domains.length}</span>
            <span className="stat-foot">{data.domains.filter((d) => d.gsc_property).length} tanesi Search Console’a bağlı</span>
          </div>
          <div className="card stat">
            <span className="stat-label">Toplam tıklama (28 gün)</span>
            <span className="stat-value num">{fmt.num(totals.clicks)}</span>
            <span className="stat-foot"><Delta value={relativeChange(totals.clicks, totals.prevClicks)} /> önceki 28 güne göre</span>
          </div>
          <div className="card stat">
            <span className="stat-label">Toplam gösterim (28 gün)</span>
            <span className="stat-value num">{fmt.num(totals.impressions)}</span>
            <span className="stat-foot"><Delta value={relativeChange(totals.impressions, totals.prevImpressions)} /> önceki 28 güne göre</span>
          </div>
        </div>
      )}

      {data?.domains?.length > 6 && (
        <div className="input-icon" style={{ maxWidth: 360 }}>
          <Search size={16} />
          <input className="input" placeholder="Alan adı ara…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cards">
          {[0, 1, 2].map((i) => <div key={i} className="card card-pad"><Skeleton height={150} /></div>)}
        </div>
      ) : data?.domains?.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Globe}
            title="Henüz alan adı eklenmedi"
            action={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={17} /> İlk alan adını ekle</button>}
          >
            Bir alan adı ekleyin; site analizi, anahtar kelime profili, site sağlığı ve hız raporları otomatik oluşturulsun. Search Console bağlamak isteğe bağlıdır.
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cards">
          {domains.map((d) => <DomainCard key={d.id} d={d} onOpen={() => navigate(`/domains/${d.id}`)} />)}
        </div>
      )}

      {adding && <AddDomainModal onClose={() => setAdding(false)} />}
    </div>
  );
}
