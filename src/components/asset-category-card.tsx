import Link from 'next/link';
import { ArrowUpRight, Bitcoin, ChartNoAxesCombined, Gem, House, Layers3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AssetCategorySummary } from '@/shared/types';

const categoryIcons: Record<string, LucideIcon> = {
  crypto: Bitcoin,
  stocks: ChartNoAxesCombined,
  'precious-metals': Gem,
  'real-estate': House,
};

export const categoryMoney = (value: number | null, currency: string) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
export const categoryPercent = (value: number | null, signed = false) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', {
        style: 'percent',
        maximumFractionDigits: 1,
        signDisplay: signed ? 'exceptZero' : 'auto',
      }).format(value / 100);
export const trendClass = (value: number | null) =>
  value === null || value === 0 ? 'muted' : value > 0 ? 'positive' : 'negative';
export const signedMoney = (value: number | null, currency: string) =>
  `${value !== null && value > 0 ? '+' : ''}${categoryMoney(value, currency)}`;
export function Performance30d({
  category,
  currency,
}: {
  category: AssetCategorySummary;
  currency: string;
}) {
  return (
    <div
      className={`category-performance ${trendClass(category.change30dAbsolute)}`}
      title={
        category.baselineDate
          ? `Comparaison au snapshot du ${new Date(category.baselineDate).toLocaleDateString('fr-FR')}`
          : 'Historique indisponible'
      }
    >
      <span>
        {categoryPercent(category.change30dPercent, true)} <span className="muted">sur 30j</span>
      </span>
      <small>{signedMoney(category.change30dAbsolute, currency)}</small>
      {category.realEstate && (
        <small>Évolution de la valeur nette · capital remboursé inclus</small>
      )}
    </div>
  );
}
export function AssetCategoryCard({
  category,
  currency,
}: {
  category: AssetCategorySummary;
  currency: string;
}) {
  const Icon = categoryIcons[category.slug] ?? Layers3;
  return (
    <Link className="panel category-card" href={`/categories/${category.slug}`}>
      <div className="category-card-title">
        <h3>
          <span className="category-icon">
            <Icon size={20} aria-hidden="true" />
          </span>
          {category.name}
        </h3>
        <ArrowUpRight size={18} aria-hidden="true" />
      </div>
      <strong className="category-value">{categoryMoney(category.totalValue, currency)}</strong>
      {category.realEstate && (
        <p className="small muted">
          Valeur nette · {categoryMoney(category.realEstate.grossValue, currency)} brut détenu ·{' '}
          {categoryMoney(category.realEstate.debt, currency)} de dette
        </p>
      )}
      <Performance30d category={category} currency={currency} />
      {category.portfolioWeight !== null && (
        <div className="category-weight" aria-hidden="true">
          <span
            style={{
              width: `${Math.max(0, Math.min(100, category.portfolioWeight))}%`,
              background: category.color,
            }}
          />
        </div>
      )}
      <div className="category-card-foot">
        <span>{categoryPercent(category.portfolioWeight)} du patrimoine</span>
        <span>
          {category.assetCount} {category.realEstate ? 'bien' : 'position'}
          {category.assetCount > 1 ? 's' : ''}
        </span>
      </div>
    </Link>
  );
}
