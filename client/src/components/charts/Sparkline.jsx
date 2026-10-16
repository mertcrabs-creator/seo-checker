import { memo } from 'react';

/** Hafif SVG sparkline (kart listelerinde Recharts yüklemeden). */
function Sparkline({ values, width = 120, height = 36 }) {
  if (!values?.length || values.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} fill="var(--chart-1)" opacity="0.1" />
      <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default memo(Sparkline);
