import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, Award, ExternalLink, FileText, Gauge, History, KeyRound, LayoutDashboard, Lightbulb, FileCheck2, FileBarChart, Link2, MapPin, Microscope, RefreshCw, Settings2, Trash2, Trophy,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { domainApi } from '../../api/endpoints';
import { Alert, EmptyState, Modal, Skeleton, Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { DAY_OPTIONS, fmt } from '../../utils/format';
import DomainSettingsModal from './DomainSettingsModal';
import ErrorBoundary from '../../components/ErrorBoundary';
import { SiteAuditBanner } from './site/shared';

/**
 * Kaynak: "gsc" (Search Console) veya "site" (kendi taramamız). SiteComp tanımlı sekmeler iki kaynakla da çalışır;
 * Search Console bağlı değilse otomatik olarak site analizi gösterilir. gscOnly sekmeler sadece GSC verisiyle anlamlıdır.
 */
const TABS = [
  {
    key: 'overview', label: 'Genel Bakış', icon: LayoutDashboard,
    Comp: lazy(() => import('./tabs/OverviewTab')), SiteComp: lazy(() => import('./site/SiteOverview')),
  },
  {
    key: 'keywords', label: 'Anahtar Kelimeler', icon: KeyRound,
    Comp: lazy(() => import('./tabs/KeywordsTab')), SiteComp: lazy(() => import('./site/SiteKeywords')),
  },
  { key: 'rankings', label: 'Sıralamalar', icon: Trophy, Comp: lazy(() => import('./tabs/RankingsTab')) },
  {
    key: 'pages', label: 'Sayfalar', icon: FileText,
    Comp: lazy(() => import('./tabs/PagesTab')), SiteComp: lazy(() => import('./site/SitePages')),
  },
  { key: 'sources', label: 'Ülke & Cihaz', icon: MapPin, Comp: lazy(() => import('./tabs/SourcesTab')), gscOnly: true },
  { key: 'index', label: 'İndeksleme', icon: FileCheck2, Comp: lazy(() => import('./tabs/IndexTab')), gscOnly: true },
  { key: 'authority', label: 'Otorite', icon: Award, Comp: lazy(() => import('./tabs/AuthorityTab')) },
  { key: 'backlinks', label: 'Backlinkler', icon: Link2, Comp: lazy(() => import('./tabs/BacklinksTab')) },
  { key: 'health', label: 'Site Sağlığı', icon: Activity, Comp: lazy(() => import('./tabs/HealthTab')) },
  { key: 'speed', label: 'Hız & Web Vitals', icon: Gauge, Comp: lazy(() => import('./tabs/SpeedTab')) },
  { key: 'opportunities', label: 'Fırsatlar', icon: Lightbulb, Comp: lazy(() => import('./tabs/OpportunitiesTab')), dual: true },
  { key: 'insights', label: 'Derin Analiz', icon: Microscope, Comp: lazy(() => import('./insights/InsightsTab')) },
  { key: 'changes', label: 'Değişiklikler', icon: History, Comp: lazy(() => import('./tabs/ChangesTab')) },
];
const isDual = (t) => Boolean(t.SiteComp || t.dual);

export default function DomainDetail() {
  const { id, tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState(28);
  const [modal, setModal] = useState(null);
  const [sourcePref, setSourcePref] = useState('gsc');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['domain', id],
    queryFn: () => domainApi.get(id),
    refetchInterval: (q) => (q.state.data?.domain?.sync_status === 'running' ? 4000 : false),
  });
  const domain = data?.domain;

  const sync = useMutation({
    mutationFn: () => domainApi.sync(id),
    onSuccess: () => {
      toast.success('Search Console senkronizasyonu başladı');
      qc.invalidateQueries({ queryKey: ['domain', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => domainApi.remove(id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['domain', id] });
      qc.invalidateQueries({ queryKey: ['domains'] });
      toast.success('Alan adı silindi');
      navigate('/domains', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Senkron bittiğinde verileri tazele
  const [prevStatus, setPrevStatus] = useState(null);
  if (domain && domain.sync_status !== prevStatus) {
    if (prevStatus === 'running' && domain.sync_status !== 'running') {
      qc.invalidateQueries({ queryKey: ['gsc', id] });
      qc.invalidateQueries({ queryKey: ['domains'] });
    }
    setPrevStatus(domain.sync_status);
  }

  if (isLoading) return <Skeleton height={300} />;
  if (isError) {
    return (
      <div className="card">
        <EmptyState title="Alan adı bulunamadı" action={<Link to="/domains" className="btn btn-secondary">Alan adlarına dön</Link>}>
          {errorMessage(error)}
        </EmptyState>
      </div>
    );
  }

  const tabs = TABS.filter((t) => !t.gscOnly || domain.gsc_property);
  const active = tabs.find((t) => t.key === tab) || tabs[0];
  const source = domain.gsc_property ? sourcePref : 'site';
  const usesGsc = active.gscOnly || (isDual(active) && source === 'gsc');
  const syncing = domain.sync_status === 'running';
  const View = isDual(active) && source === 'site' && active.SiteComp ? active.SiteComp : active.Comp;

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link to="/domains" className="row muted" style={{ gap: 4, fontSize: 13, marginBottom: 6 }}>
            <ArrowLeft size={14} /> Alan adları
          </Link>
          <div className="row">
            <h1 className="truncate">{domain.hostname}</h1>
            <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm btn-icon" aria-label="Siteyi aç">
              <ExternalLink size={16} />
            </a>
          </div>
          <p className="row" style={{ gap: 8 }}>
            {domain.gsc_property ? (
              <>Search Console: <strong>{domain.gsc_property}</strong></>
            ) : (
              <>
                Analizler site taramasından üretiliyor
                <button className="btn btn-ghost btn-sm" onClick={() => setModal('settings')}>Search Console bağla (isteğe bağlı)</button>
              </>
            )}
            {domain.last_synced_at && <span className="muted">· Son senkron {fmt.dateTime(domain.last_synced_at)}</span>}
          </p>
        </div>
        <div className="row">
          {domain.gsc_property && isDual(active) && (
            <div className="segmented" role="tablist" aria-label="Veri kaynağı">
              <button className={source === 'gsc' ? 'active' : ''} onClick={() => setSourcePref('gsc')} role="tab" aria-selected={source === 'gsc'}>Search Console</button>
              <button className={source === 'site' ? 'active' : ''} onClick={() => setSourcePref('site')} role="tab" aria-selected={source === 'site'}>Site analizi</button>
            </div>
          )}
          {usesGsc && (
            <select className="select select-sm" style={{ width: 150 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Tarih aralığı">
              {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {domain.gsc_property && (
            <button className="btn btn-secondary btn-sm" onClick={() => sync.mutate()} disabled={syncing || sync.isPending}>
              <RefreshCw size={15} className={syncing ? 'spin' : ''} /> {syncing ? 'Senkronize ediliyor' : 'Verileri güncelle'}
            </button>
          )}
          <Link to={`/domains/${id}/report`} target="_blank" className="btn btn-secondary btn-sm" title="Yazdırılabilir müşteri raporu">
            <FileBarChart size={15} /> Rapor
          </Link>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal('settings')} aria-label="Alan adı ayarları" title="Ayarlar">
            <Settings2 size={16} />
          </button>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal('delete')} aria-label="Alan adını sil" title="Sil">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {domain.sync_status === 'failed' && domain.sync_error && (
        <div style={{ marginBottom: 18 }}><Alert type="error">Son senkronizasyon başarısız: {domain.sync_error}</Alert></div>
      )}

      <nav className="tabs" role="tablist">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key} role="tab" aria-selected={key === active.key} className={`tab ${key === active.key ? 'active' : ''}`}
            onClick={() => navigate(`/domains/${id}/${key === 'overview' ? '' : key}`)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      <Suspense fallback={<Skeleton height={320} />}>
        {!domain.last_synced_at && syncing && usesGsc ? (
          <div className="card">
            <EmptyState icon={RefreshCw} title="İlk senkronizasyon sürüyor">
              Search Console verileri çekiliyor. Büyük sitelerde bu işlem birkaç dakika sürebilir. <Spinner size={14} />
            </EmptyState>
          </div>
        ) : (
          <ErrorBoundary key={`${active.key}:${source}`}>
            <div className="stack">
              {source === 'site' && isDual(active) && <SiteAuditBanner domain={domain} />}
              <View domain={domain} days={days} source={source} onOpenSettings={() => setModal('settings')} />
            </div>
          </ErrorBoundary>
        )}
      </Suspense>

      {modal === 'settings' && <DomainSettingsModal domain={domain} onClose={() => setModal(null)} />}
      {modal === 'delete' && (
        <Modal
          title="Alan adını sil"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Vazgeç</button>
              <button className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? <Spinner size={16} /> : 'Kalıcı olarak sil'}
              </button>
            </>
          }
        >
          <p><strong>{domain.hostname}</strong> ve ona ait tüm Search Console verileri, tarama ve hız raporları kalıcı olarak silinecek.</p>
        </Modal>
      )}
    </div>
  );
}
