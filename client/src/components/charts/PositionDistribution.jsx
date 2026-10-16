import { memo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt } from '../../utils/format';

export const BUCKETS = [
  { key: 'top3', label: '1–3', color: 'var(--ramp-1)' },
  { key: 'top10', label: '4–10', color: 'var(--ramp-2)' },
  { key: 'top20', label: '11–20', color: 'var(--ramp-3)' },
  { key: 'top50', label: '21–50', color: 'var(--ramp-4)' },
  { key: 'rest', label: '51+', color: 'var(--ramp-5)' },
];

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{p.label}. sıra</div>
      <div className="tt-row"><span>Anahtar kelime</span><strong>{fmt.num(p.value)}</strong></div>
    </div>
  );
}

/** Pozisyon kovaları: sıralı (ordinal) tek renk rampası — iyi pozisyon en koyu. */
function PositionDistribution({ data, height = 220, onSelect }) {
  const rows = BUCKETS.map((b) => ({ ...b, value: data?.[b.key] || 0 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={fmt.compact} allowDecimals={false} />
        <Tooltip content={<Tip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Bar
          dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}
          onClick={onSelect ? (d) => onSelect(d.key) : undefined} style={onSelect ? { cursor: 'pointer' } : undefined}
        >
          {rows.map((r) => <Cell key={r.key} fill={r.color} />)}
          <LabelList dataKey="value" position="top" formatter={fmt.compact} style={{ fill: 'var(--text-2)', fontSize: 12, fontWeight: 500 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default memo(PositionDistribution);
