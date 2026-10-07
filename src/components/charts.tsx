'use client';
import { useId } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
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
  variant = 'default',
}: {
  points: { date: string; value: number | null }[];
  currency: string;
  label?: string;
  variant?: 'default' | 'dashboard';
}) {
  const fillId = useId();
  const dashboard = variant === 'dashboard';
  const intraday =
    points.length > 1 && Date.parse(points.at(-1)!.date) - Date.parse(points[0].date) <= 86400000;
  if (points.filter((point) => point.value !== null).length < 2)
    return (
      <div
        className={
          dashboard
            ? 'mx-5 my-5 flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-(--line) bg-(--surface-secondary) p-5 text-center text-xs text-(--muted)'
            : 'chart-empty'
        }
      >
        <ChartNoAxesCombined size={28} aria-hidden="true" />
        <strong>Votre historique se construit ici</strong>
        <span>Deux captures valorisées sont nécessaires sur cette période.</span>
        <span className="small">Élargissez la période ou enregistrez un snapshot.</span>
      </div>
    );
  return (
    <div
      className={dashboard ? 'h-[260px] min-w-0 px-2 pt-5 sm:h-[285px] sm:px-3' : 'chart'}
      role="img"
      aria-label={`Évolution de la valeur : ${label}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 12, right: 12, left: 0, bottom: dashboard ? 6 : 0 }}
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={dashboard ? 0.1 : 0.14} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) =>
              dashboard && intraday
                ? new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : new Date(v).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
            }
            minTickGap={50}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 12 }}
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
            tick={{ fill: 'var(--muted)', fontSize: 12 }}
            width={58}
            domain={['auto', 'auto']}
          />
          <Tooltip
            labelFormatter={(v) =>
              dashboard
                ? new Date(String(v)).toLocaleString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : new Date(String(v)).toLocaleDateString('fr-FR')
            }
            formatter={(v) => [
              new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(v)),
              label,
            ]}
            cursor={{ stroke: 'var(--accent)', strokeDasharray: '3 4' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              boxShadow: 'var(--shadow-float)',
              fontSize: 13,
              padding: dashboard ? '12px 16px' : undefined,
            }}
            labelStyle={{ color: 'var(--muted)', marginBottom: 8 }}
            itemStyle={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
          />
          <Area
            type={dashboard ? 'linear' : 'monotone'}
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={dashboard ? 2 : 2.5}
            fill={`url(#${fillId})`}
            activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 3 }}
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
  variant = 'default',
}: {
  slices: { name: string; value: number; color: string }[];
  unit?: string;
  variant?: 'default' | 'dashboard';
}) {
  return (
    <div
      className={variant === 'dashboard' ? 'relative h-[210px] min-w-0' : 'donut'}
      role="img"
      aria-label={`Répartition par ${unit}, détaillée dans la liste adjacente`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            innerRadius={variant === 'dashboard' ? 68 : 65}
            outerRadius={variant === 'dashboard' ? 86 : 84}
            paddingAngle={slices.length === 1 && variant === 'dashboard' ? 0 : 3}
            stroke="none"
            isAnimationActive={false}
          >
            {slices.map((s, index) => (
              <Cell key={`${s.name}-${index}`} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div
        className={
          variant === 'dashboard'
            ? 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1'
            : 'donut-center'
        }
      >
        <strong
          className={variant === 'dashboard' ? 'text-3xl tracking-tight tabular-nums' : undefined}
        >
          {slices.length}
        </strong>
        <span className={variant === 'dashboard' ? 'text-xs text-(--muted)' : undefined}>
          {slices.length === 1 ? unit.replace(/s$/, '') : unit}
        </span>
      </div>
    </div>
  );
}
