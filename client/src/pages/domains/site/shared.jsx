import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileSearch, Minus, Play } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { errorMessage } from '../../../api/client';
import { domainApi } from '../../../api/endpoints';
import { Alert, EmptyState, Spinner, scoreStatus } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';

const isRunning = (a) => ['queued', 'running'].includes(a?.status);

/** Son tarama durumu (Site Sağlığı sekmesiyle aynı önbellek anahtarı). */
export function useLatestAudit(domainId) {
  return useQuery({
    queryKey: ['audit', domainId],
    queryFn: () => domainApi.latestAudit(domainId),
    refetchInterval: (q) => (isRunning(q.state.data?.audit) ? 3000 : false),
  });
}

export function useStartAudit(domainId) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => domainApi.startAudit(domainId),
    onSuccess: () => {
      toast.success('Site taraması başladı');
      qc.invalidateQueries({ queryKey: ['audit', domainId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Tarama sürerken/başarısız olduğunda bilgi bandı; tamamlanınca site verilerini tazeler. */
export function SiteAuditBanner({ domain }) {
  const qc = useQueryClient();
  const { data } = useLatestAudit(domain.id);
  const audit = data?.audit;
  const prev = useRef(audit?.status);
  useEffect(() => {
    if (isRunning({ status: prev.current }) && audit?.status && !isRunning(audit)) {
      qc.invalidateQueries({ queryKey: ['site', domain.id] });
      qc.invalidateQueries({ queryKey: ['domains'] });
    }
    prev.current = audit?.status;
  }, [audit?.status, domain.id, qc]);

  if (isRunning(audit)) {
    return (
      <Alert type="info">
        <span className="row" style={{ gap: 8 }}>
          <Spinner size={14} /> Site taranıyor. Sonuçlar tarama bitince otomatik güncellenecek.
        </span>
      </Alert>
    );
  }
  if (audit?.status === 'failed') return <Alert type="error">Son tarama başarısız oldu: {audit.error}</Alert>;
  return null;
}

export function NoAuditState({ domain }) {
  const { data } = useLatestAudit(domain.id);
  const start = useStartAudit(domain.id);
  const running = isRunning(data?.audit);
  return (
    <div className="card">
      <EmptyState
        icon={FileSearch}
        title={running ? 'Site analiz ediliyor' : 'Henüz site analizi yok'}
        action={
          <button className="btn btn-primary" onClick={() => start.mutate()} disabled={running || start.isPending}>
            {running ? <><Spinner size={15} /> Taranıyor…</> : <><Play size={16} /> Analizi başlat</>}
          </button>
        }
      >
        Tarayıcımız siteyi bir arama motoru gibi gezer. Sayfaların hedeflediği anahtar kelimeleri, içerik kalitesini, iç bağlantıları,
        teknik sorunları ve fırsatları Search Console bağlantısı olmadan çıkarır.
      </EmptyState>
    </div>
  );
}

export function ScorePill({ score }) {
  const s = scoreStatus(score);
  return <span className={`badge badge-${s.cls} num`} title={s.label}>{score ?? '—'}</span>;
}

export const Flag = ({ on, label }) =>
  on ? (
    <span className="badge badge-good" title={`${label}: var`} aria-label={`${label}: var`}><Check size={12} /></span>
  ) : (
    <span className="badge badge-neutral" title={`${label}: yok`} aria-label={`${label}: yok`}><Minus size={12} /></span>
  );
