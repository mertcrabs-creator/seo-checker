import { Lightbulb, Play, RotateCw } from 'lucide-react';
import { EmptyState, Spinner } from '../../../components/ui/Feedback';
import { safeHref, shortUrl } from '../../../utils/format';
import { useLatestAudit, useStartAudit } from '../site/shared';

export const Tip = ({ children }) => (
  <p className="text-2 row" style={{ padding: '8px 20px 0', fontSize: 12.5, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
    <Lightbulb size={14} style={{ flex: 'none', marginTop: 3, color: 'var(--warning-ink)' }} /> <span>{children}</span>
  </p>
);

export function PageLink({ url, title, max = 320 }) {
  return (
    <div style={{ minWidth: 0 }}>
      <a href={safeHref(url)} target="_blank" rel="noopener noreferrer" className="cell-main truncate" style={{ display: 'block', maxWidth: max }} title={url}>{shortUrl(url)}</a>
      {title !== undefined && <div className="cell-sub truncate" style={{ maxWidth: max }} title={title || ''}>{title || 'Son taramada yok'}</div>}
    </div>
  );
}

export function Tiles({ items }) {
  return (
    <div className="grid grid-4">
      {items.map(({ label, value, foot, icon: Icon, tone }) => (
        <div key={label} className="card stat">
          <span className="stat-label">{Icon && <span className="stat-icon" style={tone ? { background: `var(--${tone}-soft)`, color: `var(--${tone}-ink)` } : undefined}><Icon size={16} /></span>}{label}</span>
          <span className="stat-value num">{value}</span>
          {foot && <span className="stat-foot">{foot}</span>}
        </div>
      ))}
    </div>
  );
}

/** Bu özellikten önceki taramalarda gerekli veri yok: yeniden tarama çağrısı. */
export function RecrawlState({ domain, title = 'Yeni tarama gerekli', children }) {
  const { data } = useLatestAudit(domain.id);
  const start = useStartAudit(domain.id);
  const running = ['queued', 'running'].includes(data?.audit?.status);
  return (
    <div className="card">
      <EmptyState
        icon={RotateCw} title={running ? 'Site taranıyor' : title}
        action={
          <button className="btn btn-primary" onClick={() => start.mutate()} disabled={running || start.isPending}>
            {running ? <><Spinner size={15} /> Taranıyor…</> : <><Play size={16} /> Taramayı başlat</>}
          </button>
        }
      >
        {children || 'Bu analiz, tarayıcının yeni topladığı verileri (iç bağlantı grafiği, yapısal veri doğrulaması) kullanır. Bir kez yeniden tarama yeterlidir; haftalık otomatik tarama da bunu yapar.'}
      </EmptyState>
    </div>
  );
}

/** Basit SVG çubuk sparkline (aylık seri). */
export function MiniBars({ values, width = 120, height = 28, highlightFrom }) {
  const max = Math.max(1, ...values);
  const w = width / values.length;
  return (
    <svg width={width} height={height} role="img" aria-label="Aylık tıklama trendi" style={{ display: 'block' }}>
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * (height - 2));
        return (
          <rect
            key={i} x={i * w + 1} y={height - h} width={Math.max(1, w - 2)} height={h} rx={1.5}
            fill={highlightFrom !== undefined && i >= highlightFrom ? 'var(--critical)' : 'var(--chart-1)'} opacity={highlightFrom !== undefined && i >= highlightFrom ? 0.85 : 0.6}
          />
        );
      })}
    </svg>
  );
}

export const INTENT_LABELS = {
  transactional: { label: 'İşlem', cls: 'badge-good', tip: 'Satın alma / fiyat / randevu niyeti' },
  commercial: { label: 'Ticari araştırma', cls: 'badge-notice', tip: 'Karşılaştırma, en iyi, yorum' },
  informational: { label: 'Bilgi', cls: 'badge-neutral', tip: 'Nedir, nasıl, rehber' },
  navigational: { label: 'Marka', cls: 'badge-warning', tip: 'Markanızı arayanlar' },
};
export const IntentBadge = ({ intent }) => {
  const i = INTENT_LABELS[intent];
  return i ? <span className={`badge ${i.cls}`} title={i.tip}>{i.label}</span> : <span className="muted">—</span>;
};
