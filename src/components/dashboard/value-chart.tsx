'use client';
import { useId, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SNAPSHOT_TIMEZONE, snapshotChartPoints } from '@/domain/snapshot-day';
import { money } from '@/components/workspace/display';
import type { CategoryHistoryPoint } from '@/shared/types';
import styles from './dashboard.module.css';

export const observationDate = (date: string | number) =>
  new Date(date).toLocaleString('fr-FR', {
    timeZone: SNAPSHOT_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function ValueChart({
  points,
  currency,
  name,
  mini = false,
  color = 'var(--accent)',
}: {
  points: CategoryHistoryPoint[];
  currency: string;
  name: string;
  mini?: boolean;
  color?: string;
}) {
  const id = useId();
  const [touchFocus, setTouchFocus] = useState(false);
  const data = snapshotChartPoints(points).map((point) => ({
    ...point,
    timestamp: Date.parse(point.date),
  }));
  if (points.filter((point) => point.value !== null).length < 2)
    return (
      <div className={mini ? styles.miniEmpty : styles.chartEmpty}>
        <strong>Historique insuffisant</strong>
        <span>Deux captures valorisées sont nécessaires sur cette période.</span>
        {!mini && <span>Les relevés quotidiens existants alimentent cet historique.</span>}
      </div>
    );
  return (
    <div
      className={mini ? styles.miniChart : styles.chart}
      data-touch-focus={touchFocus}
      onPointerDownCapture={(event) => setTouchFocus(event.pointerType === 'touch')}
      onKeyDownCapture={() => setTouchFocus(false)}
      role="group"
      aria-label={`Évolution de la valeur : ${name}`}
    >
      <span className="sr-only">
        Valeurs enregistrées, achats et ventes compris. Flèches gauche et droite pour explorer les
        captures. Les jours manquants ne sont pas reliés.
      </span>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          accessibilityLayer
          margin={{ top: 10, bottom: mini ? 10 : 8, left: mini ? 6 : 0, right: mini ? 6 : 12 }}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {!mini && <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" />}
          <XAxis
            hide={mini}
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(date) =>
              new Date(date).toLocaleDateString('fr-FR', {
                timeZone: SNAPSHOT_TIMEZONE,
                day: 'numeric',
                month: 'short',
              })
            }
            minTickGap={28}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
          />
          <YAxis
            hide={mini}
            domain={
              mini
                ? ([min, max]) => {
                    // Leave room for the stroke and active dots, including flat/zero histories.
                    const padding = (max - min || Math.abs(max) || 1) * 0.12;
                    return [min - padding, max + padding];
                  }
                : ['auto', 'auto']
            }
            width={55}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickFormatter={(v) =>
              new Intl.NumberFormat('fr-FR', {
                notation: Math.abs(v) >= 1e6 ? 'compact' : 'standard',
                maximumFractionDigits: Math.abs(v) < 100 ? 2 : Math.abs(v) >= 1e6 ? 2 : 0,
              }).format(v)
            }
          />
          <Tooltip
            labelFormatter={(v) => observationDate(typeof v === 'number' ? v : String(v))}
            formatter={(v) => [money(Number(v), currency), name]}
            cursor={{ stroke: color, strokeDasharray: '3 4' }}
            contentStyle={{
              background: '#fff',
              color: '#19202c',
              border: '1px solid #e8e9f0',
              borderRadius: 10,
              fontSize: 12,
            }}
            itemStyle={{ color: '#19202c', fontVariantNumeric: 'tabular-nums' }}
            allowEscapeViewBox={{ y: true }}
          />
          <Area
            type="linear"
            dataKey="value"
            stroke={color}
            strokeWidth={1.7}
            fill={`url(#${id})`}
            connectNulls={false}
            isAnimationActive={false}
            dot={(props) => {
              // Isolated observations remain visible instead of disappearing in a gap.
              const { cx, cy, index } = props;
              const isolated =
                !data[index - 1] ||
                data[index - 1].value === null ||
                !data[index + 1] ||
                data[index + 1].value === null;
              return (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={data[index]?.value != null && isolated ? 2.5 : 0}
                  fill={color}
                />
              );
            }}
            activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
