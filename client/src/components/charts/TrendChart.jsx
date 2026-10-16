import { memo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt } from '../../utils/format';

export const METRICS = {
  clicks: { label: 'Tıklama', format: fmt.num, axis: fmt.compact },
  impressions: { label: 'Gösterim', format: fmt.num, axis: fmt.compact },
  ctr: { label: 'TO (CTR)', format: fmt.pct, axis: (v) => `${(v * 100).toFixed(0)}%` },
  position: { label: 'Ort. pozisyon', format: fmt.pos, axis: (v) => v, invert: true },
};

function TrendTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  const m = METRICS[metric];
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{fmt.dateShort(label)}</div>
      <div className="tt-row">
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--chart-1)' }} /> {m.label}
        </span>
        <strong>{m.format(payload[0].value)}</strong>
      </div>
    </div>
  );
}

/**
 * Tek seri, tek eksen: metrikler farklı ölçekte olduğundan aynı grafikte üst üste çizilmez;
 * kullanıcı metrik seçer. Pozisyonda eksen ters çevrilir (1 en üstte).
 */
function TrendChart({ data, metric = 'clicks', height = 280 }) {
  const m = METRICS[metric];
  const gradientId = `grad-${metric}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date" tickFormatter={fmt.dateShort} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }}
          minTickGap={28} tickMargin={8}
        />
        <YAxis
          tickFormatter={m.axis} tickLine={false} axisLine={false} width={48}
          reversed={m.invert} domain={m.invert ? [1, 'auto'] : [0, 'auto']} allowDecimals={metric !== 'clicks' && metric !== 'impressions'}
        />
        <Tooltip content={<TrendTooltip metric={metric} />} cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }} />
        <Area
          type="monotone" dataKey={metric} stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${gradientId})`}
          dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default memo(TrendChart);
