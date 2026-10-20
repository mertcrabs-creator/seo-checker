import { memo, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt } from '../../utils/format';

export const METRICS = {
  clicks: { label: 'Tıklama', format: fmt.num, axis: fmt.compact },
  impressions: { label: 'Gösterim', format: fmt.num, axis: fmt.compact },
  ctr: { label: 'TO (CTR)', format: fmt.pct, axis: (v) => `${(v * 100).toFixed(0)}%` },
  position: { label: 'Ort. pozisyon', format: fmt.pos, axis: (v) => v, invert: true },
  // CrabRank ziyaretçi takibi
  sessions: { label: 'Oturum', format: fmt.num, axis: fmt.compact, integer: true },
  visitors: { label: 'Ziyaretçi', format: fmt.num, axis: fmt.compact, integer: true },
  conversions: { label: 'Dönüşüm', format: fmt.num, axis: fmt.compact, integer: true },
};

export const UPDATE_COLORS = { core: 'var(--warning)', spam: 'var(--critical)', other: 'var(--text-3)' };

function TrendTooltip({ active, payload, label, metric, marks }) {
  if (!active || !payload?.length) return null;
  const m = METRICS[metric];
  const notes = marks?.notes.get(label) || [];
  const updates = marks?.updates.filter((u) => u.x1 <= label && u.x2 >= label) || [];
  const change = marks?.changes.get(label);
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{fmt.dateShort(label)}</div>
      <div className="tt-row">
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--chart-1)' }} /> {m.label}
        </span>
        <strong>{m.format(payload[0].value)}</strong>
      </div>
      {updates.map((u) => (
        <div key={u.name} className="tt-row" style={{ color: 'var(--text-2)' }}>
          <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: UPDATE_COLORS[u.kind] }} /> {u.name}</span>
        </div>
      ))}
      {notes.map((n) => (
        <div key={n.id} className="tt-row" style={{ color: 'var(--text-2)' }}>
          <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--primary)' }} /> {n.title}</span>
        </div>
      ))}
      {change && (
        <div className="tt-row" style={{ color: 'var(--text-2)' }}>
          <span className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: change.critical ? 'var(--critical)' : 'var(--warning)' }} />
            {change.pages} sayfada önemli değişiklik
          </span>
        </div>
      )}
    </div>
  );
}

/** Notları grafiğin kategori eksenine (veri günlerine) oturtur; aralık dışındakileri atar. */
function useMarks(data, annotations) {
  return useMemo(() => {
    if (!annotations || !data?.length) return null;
    const dates = data.map((d) => d.date);
    const first = dates[0];
    const last = dates.at(-1);
    const snap = (iso, dir) => (dir > 0 ? dates.find((d) => d >= iso) : [...dates].reverse().find((d) => d <= iso));
    const notes = new Map();
    for (const n of annotations.notes || []) {
      const x = snap(n.date, 1);
      if (x && n.date <= last) notes.set(x, [...(notes.get(x) || []), n]);
    }
    const updates = (annotations.updates || [])
      .map((u) => ({ ...u, x1: snap(u.start < first ? first : u.start, 1), x2: snap(!u.end || u.end > last ? last : u.end, -1) }))
      .filter((u) => u.x1 && u.x2 && u.x1 <= u.x2);
    const changes = new Map((annotations.changes || []).filter((c) => dates.includes(c.date)).map((c) => [c.date, c]));
    return { notes, updates, changes };
  }, [data, annotations]);
}

/**
 * Tek seri, tek eksen: metrikler farklı ölçekte olduğundan aynı grafikte üst üste çizilmez;
 * kullanıcı metrik seçer. Pozisyonda eksen ters çevrilir (1 en üstte).
 * `annotations`: Google güncellemeleri (alan), kullanıcı notları (mavi çizgi), sayfa değişiklikleri (kesikli çizgi).
 */
function TrendChart({ data, metric = 'clicks', height = 280, annotations }) {
  const m = METRICS[metric];
  const gradientId = `grad-${metric}`;
  const marks = useMarks(data, annotations);
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
          reversed={m.invert} domain={m.invert ? [1, 'auto'] : [0, 'auto']} allowDecimals={metric !== 'clicks' && metric !== 'impressions' && !m.integer}
        />
        {marks?.updates.map((u) => (
          <ReferenceArea key={u.name} x1={u.x1} x2={u.x2} fill={UPDATE_COLORS[u.kind]} fillOpacity={0.09} strokeOpacity={0} ifOverflow="hidden" />
        ))}
        {marks && [...marks.changes.values()].map((c) => (
          <ReferenceLine key={`c${c.date}`} x={c.date} stroke={c.critical ? 'var(--critical)' : 'var(--warning)'} strokeDasharray="2 4" strokeWidth={1.5} />
        ))}
        {marks && [...marks.notes.keys()].map((x) => (
          <ReferenceLine key={`n${x}`} x={x} stroke="var(--primary)" strokeWidth={1.5} />
        ))}
        <Tooltip content={<TrendTooltip metric={metric} marks={marks} />} cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }} />
        <Area
          type="monotone" dataKey={metric} stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${gradientId})`}
          dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default memo(TrendChart);
