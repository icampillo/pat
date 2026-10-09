import { dashboardCard, PerformanceBadge } from '@/components/dashboard/primitives';
import Link from '@/components/workspace/link';
import { ArrowUpRight } from 'lucide-react';
import { categoryAppearance, categoryStyle } from '@/components/ui/category-appearance';
import type { AssetCategorySummary } from '@/shared/types';

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
          ? `Comparaison au snapshot du ${new Date(category.baselineDate).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`
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
  const { Icon } = categoryAppearance(category.slug);
  return (
    <Link
      className={`${dashboardCard} group flex flex-col gap-4 p-5 transition-[border-color,transform] hover:border-(--accent)/35 motion-safe:hover:-translate-y-0.5`}
      href={`/categories/${category.slug}`}
      style={categoryStyle(category.slug)}
      data-testid="investment-card"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--category-color)_9%,white)] text-[color-mix(in_srgb,var(--category-color)_80%,black)]">
          <Icon size={19} aria-hidden="true" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm! [overflow-wrap:anywhere]">{category.name}</h3>
        <ArrowUpRight
          size={16}
          className="shrink-0 text-(--muted) transition-colors group-hover:text-(--accent)"
          aria-hidden="true"
        />
      </div>
      <div className="flex flex-col gap-2">
        <strong className="text-[clamp(1.5rem,2vw,1.9rem)] leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">
          {categoryMoney(category.totalValue, currency)}
        </strong>
        <div
          className="flex flex-wrap items-center gap-2"
          title={
            category.baselineDate
              ? `Comparaison au snapshot du ${new Date(category.baselineDate).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`
              : 'Historique indisponible'
          }
        >
          <PerformanceBadge value={category.change30dPercent}>
            {categoryPercent(category.change30dPercent, true)}
          </PerformanceBadge>
          <span className="text-xs text-(--muted)">sur 30j</span>
          <span className="text-xs text-(--muted) tabular-nums">
            {signedMoney(category.change30dAbsolute, currency)}
          </span>
        </div>
        {category.totalValue === null && (
          <p className="text-xs text-(--warning)">Valorisation incomplète</p>
        )}
        {category.realEstate && (
          <div className="text-xs leading-relaxed text-(--muted)">
            <p>
              Valeur nette · {categoryMoney(category.realEstate.grossValue, currency)} brut détenu ·{' '}
              {categoryMoney(category.realEstate.debt, currency)} de dette
            </p>
            <p>Évolution de la valeur nette · capital remboursé inclus</p>
          </div>
        )}
      </div>
      <div className="mt-auto flex flex-col gap-3 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-(--muted)">
          <span>{categoryPercent(category.portfolioWeight)} du patrimoine</span>
          <span>
            {category.assetCount} {category.realEstate ? 'bien' : 'position'}
            {category.assetCount > 1 ? 's' : ''}
          </span>
        </div>
        {category.portfolioWeight !== null && (
          <div
            className="h-1 overflow-hidden rounded-full bg-(--surface-secondary)"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-(--category-color)"
              style={{ width: `${Math.max(0, Math.min(100, category.portfolioWeight))}%` }}
            />
          </div>
        )}
      </div>
    </Link>
  );
}
