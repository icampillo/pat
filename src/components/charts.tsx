'use client';
import { SNAPSHOT_TIMEZONE, snapshotChartPoints } from '@/domain/snapshot-day';
import { useId, useState } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { money } from '@/components/workspace/display';
import { calculateCategoryWeight } from '@/domain/categories';
import styles from '@/components/dashboard/dashboard.module.css';
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
  Sector,
  type PieSectorShapeProps,
} from 'recharts';
export function EvolutionChart({
  points,
  currency,
  label = 'Patrimoine',
  variant = 'default',
  daily = true,
}: {
  points: { date: string; value: number | null }[];
  currency: string;
  label?: string;
  variant?: 'default' | 'dashboard';
  daily?: boolean;
}) {
  const fillId = useId();
  const dashboard = variant === 'dashboard';
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
        <span className="small">Les relevés sont automatiques chaque jour (Europe/Paris).</span>
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
          data={daily ? snapshotChartPoints(points) : points}
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
              new Date(v).toLocaleDateString('fr-FR', {
                timeZone: SNAPSHOT_TIMEZONE,
                day: 'numeric',
                month: 'short',
              })
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
                    timeZone: SNAPSHOT_TIMEZONE,
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : new Date(String(v)).toLocaleDateString('fr-FR', { timeZone: SNAPSHOT_TIMEZONE })
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
  currency = 'EUR',
  total = null,
  selectedName = null,
  onSelect,
}: {
  slices: { name: string; value: number; color: string }[];
  unit?: string;
  variant?: 'default' | 'dashboard';
  currency?: string;
  total?: number | null;
  selectedName?: string | null;
  onSelect?: (name: string | null) => void;
}) {
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const dashboard = variant === 'dashboard';
  const active = slices.find((slice) => slice.name === (hoveredName ?? selectedName));
  const weight = calculateCategoryWeight(active?.value ?? null, total);
  const select = (name: string) => onSelect?.(selectedName === name ? null : name);
  return (
    <div
      className={dashboard ? 'relative h-[210px] min-w-0' : 'donut'}
      role={onSelect ? 'group' : 'img'}
      aria-label={`Répartition par ${unit}, détaillée dans la liste adjacente`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onSelect?.(null);
          setHoveredName(null);
        }
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer={!onSelect}>
          <Pie
            data={slices}
            dataKey="value"
            innerRadius={dashboard ? 68 : 65}
            outerRadius={dashboard ? 86 : 84}
            paddingAngle={slices.length === 1 && dashboard ? 0 : 3}
            startAngle={dashboard ? 90 : 0}
            endAngle={dashboard ? -270 : 360}
            cornerRadius={dashboard ? 4 : 0}
            stroke="none"
            isAnimationActive={dashboard ? 'auto' : false}
            animationBegin={100}
            animationDuration={1000}
            animationEasing="ease-out"
            rootTabIndex={onSelect ? -1 : 0}
            onClick={onSelect ? (_, index) => select(slices[index].name) : undefined}
            onMouseEnter={onSelect ? (_, index) => setHoveredName(slices[index].name) : undefined}
            onMouseLeave={onSelect ? () => setHoveredName(null) : undefined}
            shape={
              onSelect
                ? (props: PieSectorShapeProps) => {
                    const slice = slices[props.index];
                    const highlighted = active?.name === slice.name;
                    return (
                      <Sector
                        cx={props.cx}
                        cy={props.cy}
                        innerRadius={props.innerRadius}
                        outerRadius={props.outerRadius}
                        startAngle={props.startAngle}
                        endAngle={props.endAngle}
                        cornerRadius={props.cornerRadius}
                        fill={slice.color}
                        className={styles.allocationSector}
                        style={{
                          transformOrigin: `${props.cx}px ${props.cy}px`,
                          transform: highlighted ? 'scale(1.06)' : 'scale(1)',
                          opacity: active && !highlighted ? 0.45 : 1,
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${slice.name} : ${money(slice.value, currency)}`}
                        aria-pressed={selectedName === slice.name}
                        onFocus={() => setHoveredName(slice.name)}
                        onBlur={() => setHoveredName(null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            select(slice.name);
                          }
                        }}
                      />
                    );
                  }
                : undefined
            }
          >
            {slices.map((s, index) => (
              <Cell key={`${s.name}-${index}`} fill={s.color} />
            ))}
          </Pie>
          {onSelect && (
            <Tooltip
              formatter={(value) => money(Number(value), currency)}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                fontSize: 12,
                boxShadow: 'var(--shadow-float)',
              }}
              itemStyle={{ color: 'var(--ink)' }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      <div
        className={
          dashboard
            ? 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1'
            : 'donut-center'
        }
      >
        <strong className={dashboard ? 'max-w-32 text-2xl tracking-tight tabular-nums' : undefined}>
          {active ? (weight === null ? '—' : `${weight.toFixed(1)} %`) : slices.length}
        </strong>
        <span
          className={
            dashboard
              ? 'max-w-28 text-center text-xs text-(--muted) [overflow-wrap:anywhere]'
              : undefined
          }
        >
          {active?.name ?? (slices.length === 1 ? unit.replace(/s$/, '') : unit)}
        </span>
      </div>
    </div>
  );
}
