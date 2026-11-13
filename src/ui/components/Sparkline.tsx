export function Sparkline({ values, width = 120, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const max = Math.max(...values, 1e-9);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className="cfl-spark" aria-hidden>
      <polyline points={points} fill="none" strokeWidth={1.5} />
    </svg>
  );
}
