import { AlertCircle, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Minus, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fmt } from '../../utils/format';

export const Spinner = ({ size = 18 }) => <span className="spinner" style={{ width: size, height: size }} aria-label="Yükleniyor" />;

export const Skeleton = ({ height = 16, width = '100%', style }) => <div className="skeleton" style={{ height, width, ...style }} />;

export function EmptyState({ icon: Icon = Info, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={24} /></div>
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: 440 }}>{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ type = 'info', children }) {
  const Icon = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info }[type];
  return (
    <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={17} style={{ flex: 'none', marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

const SEVERITY = {
  critical: { label: 'Kritik', Icon: AlertCircle },
  warning: { label: 'Uyarı', Icon: AlertTriangle },
  notice: { label: 'Bilgi', Icon: Info },
};
export function SeverityBadge({ severity }) {
  const { label, Icon } = SEVERITY[severity] || SEVERITY.notice;
  return (
    <span className={`badge badge-${severity}`}>
      <Icon size={13} /> {label}
    </span>
  );
}

/**
 * Dönem değişimi. `invert`: pozisyon gibi düşük olanın iyi olduğu metrikler.
 * `mode="abs"` mutlak fark (pozisyon), aksi halde yüzde.
 */
export function Delta({ value, invert = false, mode = 'pct' }) {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return <span className="delta delta-flat">—</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < (mode === 'pct' ? 0.0005 : 0.05);
  const cls = flat ? 'delta-flat' : good ? 'delta-up' : 'delta-down';
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const text = mode === 'pct' ? fmt.pct(Math.abs(value)) : Math.abs(value).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  return (
    <span className={`delta ${cls}`} title={good ? 'İyileşme' : flat ? 'Değişim yok' : 'Kötüleşme'}>
      <Icon size={13} /> {text}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, width }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** 0-100 puan halkası; renk durum paletinden, yanında her zaman metin etiketi. */
export function scoreStatus(score) {
  if (score === null || score === undefined) return { color: 'var(--border-strong)', label: 'Veri yok', cls: 'neutral' };
  if (score >= 90) return { color: 'var(--good)', label: 'İyi', cls: 'good' };
  if (score >= 50) return { color: 'var(--warning)', label: 'Geliştirilmeli', cls: 'warning' };
  return { color: 'var(--critical)', label: 'Zayıf', cls: 'critical' };
}

export function ScoreRing({ score, size = 112, stroke = 9, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const s = scoreStatus(score);
  const pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="score-ring" style={{ width: size, height: size }} role="img" aria-label={`${label || 'Puan'}: ${score ?? 'yok'} / 100, ${s.label}`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-hover)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="score-val">
        <div>
          <strong style={{ fontSize: size < 80 ? 18 : 26 }}>{score ?? '—'}</strong>
          {size >= 80 && <span style={{ display: 'block' }}>{label || s.label}</span>}
        </div>
      </div>
    </div>
  );
}
