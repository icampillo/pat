'use client';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Coins,
  Gem,
  House,
  Layers3,
  Wallet,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import Link from '@/components/workspace/link';
import { money } from '@/components/workspace/display';
import { calculateCategoryWeight, filterCategoryHistory } from '@/domain/categories';
import { valueChange7d } from '@/domain/dashboard';
import type { CategoryHistoryPoint } from '@/shared/types';
import { observationDate, ValueChart } from './value-chart';
import styles from './dashboard.module.css';

// Presentation only: stored category colors and the other pages are unchanged.
export function categoryAppearance(key: string) {
  const known = {
    CRYPTO: { color: '#763cff', soft: '#dcd0ff', Icon: Coins },
    SECURITIES: { color: '#ee775e', soft: '#ffdbd1', Icon: ChartNoAxesColumnIncreasing },
    METALS: { color: '#bd850c', soft: '#fff0bc', Icon: Gem },
    CASH: { color: '#168ee0', soft: '#cfebfc', Icon: Wallet },
    REAL_ESTATE: { color: '#6974c8', soft: '#e0e3fa', Icon: House },
  };
  if (key in known) return known[key as keyof typeof known];
  const hues = [265, 215, 310, 38, 235, 285];
  const hash = [...key].reduce((value, ch) => (value * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const hue = hues[hash % hues.length];
  return { color: `hsl(${hue} 45% 43%)`, soft: `hsl(${hue} 65% 90%)`, Icon: Layers3 };
}
export type DashboardCategory = {
  id: string;
  key: string;
  name: string;
  value: number | null;
  href: string;
  history: CategoryHistoryPoint[];
  note?: string;
};
export function weightLabel(value: number | null, total: number | null) {
  const weight = calculateCategoryWeight(value, total);
  return weight === null
    ? 'Poids indisponible'
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(weight)} % du patrimoine`;
}
export function ValueChange({
  value,
  history,
  asOf,
  revised,
}: {
  value: number | null;
  history: CategoryHistoryPoint[];
  asOf: string;
  revised: boolean;
}) {
  const change = valueChange7d(value, history, asOf, revised);
  const percent = change.percent;
  const Icon = percent !== null && percent > 0 ? ArrowUpRight : ArrowDownRight;
  const text =
    percent === null
      ? '—'
      : `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(percent))} %`;
  return (
    <details
      className={styles.change}
      style={
        {
          '--trend':
            percent === null || percent === 0
              ? 'var(--muted)'
              : percent > 0
                ? 'var(--green)'
                : 'var(--red)',
        } as CSSProperties
      }
    >
      <summary aria-label={`Variation de valeur sur 7 jours : ${text}. Afficher l’explication`}>
        {percent !== null && percent !== 0 && <Icon size={16} aria-hidden="true" />}
        <span>{text}</span>
        <span className={styles.changePeriod}>· 7 j</span>
      </summary>
      <p>
        {change.reason ??
          `Variation de valeur détenue entre le ${observationDate(change.baselineDate!)} et le ${observationDate(asOf)} (Europe/Paris), achats et ventes compris. Ce n’est pas un rendement corrigé des flux.`}
      </p>
    </details>
  );
}
export function CategoryCard({
  category,
  total,
  currency,
  period,
  asOf,
  revised,
}: {
  category: DashboardCategory;
  total: number | null;
  currency: string;
  period: string;
  asOf: string;
  revised: boolean;
}) {
  const { color, soft, Icon } = categoryAppearance(category.key);
  return (
    <article
      className={styles.categoryCard}
      data-testid="investment-card"
      style={{ '--category-color': color, '--category-soft': soft } as CSSProperties}
    >
      <div className={styles.categoryHead}>
        <span className={styles.categoryIcon}>
          <Icon size={25} aria-hidden="true" />
        </span>
        <div className={styles.categoryContent}>
          <Link className={styles.categoryLink} href={category.href}>
            <h3>{category.name}</h3>
            <ChevronRight size={19} aria-hidden="true" />
          </Link>
          <div className={styles.amountRow}>
            <strong>{money(category.value, currency)}</strong>
            <ValueChange
              value={category.value}
              history={category.history}
              asOf={asOf}
              revised={revised}
            />
          </div>
          <p className={styles.weight}>
            {category.value === null ? 'Valorisation incomplète · ' : ''}
            {weightLabel(category.value, total)}
          </p>
        </div>
      </div>
      <ValueChart
        points={filterCategoryHistory(category.history, period, asOf)}
        name={category.name}
        currency={currency}
        color={color}
        mini
      />
      {category.note && <p className={styles.categoryNote}>{category.note}</p>}
    </article>
  );
}
