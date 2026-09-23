'use client';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
export function EvolutionChart({
  points,
  currency,
  label = 'Patrimoine',
}: {
  points: { date: string; value: number | null }[];
  currency: string;
  label?: string;
}) {
  if (points.filter((point) => point.value !== null).length < 2)
    return <div className="chart-empty">Créez vos premiers snapshots pour suivre l’évolution.</div>;
  return (
    <div className="chart" role="img" aria-label={`Évolution de la valeur : ${label}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6556dc" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#6556dc" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#edf0f5" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) =>
              new Date(v).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
            }
            minTickGap={50}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#8791a3', fontSize: 12 }}
          />
          <YAxis
            tickFormatter={(v) =>
              new Intl.NumberFormat('fr-FR', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(v)
            }
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#8791a3', fontSize: 12 }}
            width={45}
            domain={['auto', 'auto']}
          />
          <Tooltip
            labelFormatter={(v) => new Date(String(v)).toLocaleDateString('fr-FR')}
            formatter={(v) => [
              new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(v)),
              label,
            ]}
            contentStyle={{ borderRadius: 12, border: '1px solid #e8ebf2', fontSize: 14 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#6556dc"
            strokeWidth={2.5}
            fill="url(#valueFill)"
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function AllocationChart({
  slices,
  unit = 'catégories',
}: {
  slices: { name: string; value: number; color: string }[];
  unit?: string;
}) {
  return (
    <div
      className="donut"
      role="img"
      aria-label={`Répartition par ${unit}, détaillée dans la liste adjacente`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            innerRadius={65}
            outerRadius={84}
            paddingAngle={3}
            stroke="none"
            isAnimationActive={false}
          >
            {slices.map((s, index) => (
              <Cell key={`${s.name}-${index}`} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center">
        <strong>{slices.length}</strong>
        <span>{slices.length === 1 ? unit.replace(/s$/, '') : unit}</span>
      </div>
    </div>
  );
}
