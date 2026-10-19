'use client';
import { TableScroll } from '@/components/ui/table-scroll';
import { sortByValue } from '@/domain/value-sort';
import { useState } from 'react';
import Link from '@/components/workspace/link';
import { categoryAppearance, categoryStyle } from '@/components/ui/category-appearance';
import {
  calculateCategoryWeight,
  calculatePerformance,
  filterCategoryHistory,
} from '@/domain/categories';
import type { AssetCategoryDetails } from '@/shared/types';
import { AllocationChart, EvolutionChart } from './charts';
import {
  categoryMoney,
  categoryPercent,
  Performance30d,
  signedMoney,
  trendClass,
} from './asset-category-card';

export function CategoryPage({
  details,
  currency,
  asOf,
}: {
  details: AssetCategoryDetails;
  currency: 'EUR' | 'USD';
  asOf: string;
}) {
  const [period, setPeriod] = useState('30d');
  const { category } = details;
  const { color } = categoryAppearance(category.slug);
  // Shades stay in the category family; names and values identify each position.
  const positionColor = (index: number) =>
    `color-mix(in srgb, ${color} ${100 - (index % 5) * 14}%, white)`;
  const assets = sortByValue(details.assets, (asset) => asset.value);
  const estate = category.realEstate;
  const repaymentProgress =
    estate?.borrowedAmount && estate.principalPaid !== null
      ? (estate.principalPaid / estate.borrowedAmount) * 100
      : null;
  const points = filterCategoryHistory(details.history, period, asOf, true);
  const slices = assets
    .map((asset, index) => ({
      name: asset.name,
      value: asset.value!,
      color: positionColor(index),
    }))
    .filter((slice) => slice.value !== null && slice.value > 0);
  const incomplete = category.totalValue === null;
  const negativeValues = assets.some((asset) => asset.value !== null && asset.value < 0);
  return (
    <div style={categoryStyle(category.slug)}>
      <div className="metrics category-metrics">
        <section className="metric">
          <div className="metric-top">{estate ? 'Patrimoine immobilier net' : 'Valeur totale'}</div>
          <strong>{categoryMoney(category.totalValue, currency)}</strong>
          <p>
            {category.assetCount} {estate ? 'bien' : 'position'}
            {category.assetCount > 1 ? 's' : ''}
            {incomplete ? ' · valorisation incomplète' : ''}
          </p>
        </section>
        <section className="metric">
          <div className="metric-top">
            {estate ? 'Capital déjà remboursé' : 'Performance 30 jours'}
          </div>
          {estate ? (
            <>
              <strong>{categoryMoney(estate.principalPaid, currency)}</strong>
              {repaymentProgress !== null && (
                <label>
                  {categoryPercent(repaymentProgress)} du capital initial
                  <progress max={100} value={repaymentProgress} />
                </label>
              )}
            </>
          ) : (
            <Performance30d category={category} currency={currency} />
          )}
          <p>
            {estate
              ? `Montant initial : ${categoryMoney(estate.borrowedAmount, currency)}`
              : (category.change30dReason ??
                (category.baselineDate
                  ? `Snapshot du ${new Date(category.baselineDate).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`
                  : 'Historique indisponible'))}
          </p>
        </section>
        <section className="metric">
          <div className="metric-top">{estate ? 'Valeur brute détenue' : 'Capital investi'}</div>
          <strong>
            {categoryMoney(estate ? estate.grossValue : details.investedCapital, currency)}
          </strong>
          <p>
            {estate
              ? 'Valeur du bien × pourcentage détenu'
              : details.investedCapital === null
                ? 'Données d’acquisition incomplètes'
                : 'Coût des positions encore détenues'}
          </p>
        </section>
        <section className="metric">
          <div className="metric-top">{estate ? 'Capital restant dû' : 'Plus-value latente'}</div>
          <strong className={trendClass(details.unrealizedPnL)}>
            {estate
              ? categoryMoney(estate.debt, currency)
              : signedMoney(details.unrealizedPnL, currency)}
          </strong>
          <p>
            {estate
              ? 'Capital restant dû attribué'
              : categoryPercent(details.unrealizedPnLPercent, true)}
          </p>
        </section>
      </div>
      {estate && (
        <section className="panel detail-panel">
          <h2>Valorisation immobilière</h2>
          <dl className="details-list">
            <div>
              <dt>Valeur d’achat détenue, hors frais</dt>
              <dd>{categoryMoney(estate.purchaseValue, currency)}</dd>
            </div>
            <div>
              <dt>Valeur actuelle estimée détenue</dt>
              <dd>{categoryMoney(estate.grossValue, currency)}</dd>
            </div>
            <div>
              <dt>Plus-value / moins-value latente, hors frais</dt>
              <dd>{signedMoney(estate.grossGain, currency)}</dd>
            </div>
          </dl>
          <p className="small muted">
            Le patrimoine net est la valeur brute détenue moins le capital restant dû. Il inclut
            l’apport, les remboursements et la variation de valeur du bien, sans les additionner une
            seconde fois.
          </p>
        </section>
      )}
      <div className="charts-grid">
        <section className="panel evolution">
          <div className="section-title">
            <div>
              <h2>Évolution · {category.name}</h2>
              <p>
                {estate
                  ? 'Valeur nette immobilière · remboursements de capital inclus, sans mesure du rendement'
                  : 'Valeur observée, apports et ventes compris'}
              </p>
            </div>
            <div className="periods" aria-label="Période du graphique">
              {[
                ['7d', '7j'],
                ['30d', '30j'],
                ['90d', '90j'],
                ['1y', '1 an'],
                ['all', 'Tout'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={period === value}
                  className={period === value ? 'selected' : ''}
                  onClick={() => setPeriod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <EvolutionChart points={points} currency={currency} label={category.name} color={color} />
          <p className="chart-foot">Historique quotidien · {currency}</p>
        </section>
        <section className="panel allocation">
          <div className="section-title">
            <div>
              <h2>Répartition interne</h2>
              <p>Poids des positions dans la catégorie</p>
            </div>
          </div>
          {!incomplete && !negativeValues && slices.length > 0 && (
            <AllocationChart slices={slices} unit="positions" />
          )}
          {incomplete && (
            <p className="empty-inline">Répartition incomplète : prix ou taux manquant.</p>
          )}
          {negativeValues && (
            <p className="empty-inline">Valeurs nettes incluant les dettes et ajustements.</p>
          )}
          <div className="legend category-legend">
            {assets.map((asset, index) => (
              <div key={asset.id}>
                <span className="dot" style={{ background: positionColor(index) }} />
                <span>{asset.name}</span>
                <strong>
                  {categoryPercent(calculateCategoryWeight(asset.value, category.totalValue))}
                </strong>
              </div>
            ))}
          </div>
          {!assets.length && <p className="empty-inline">Aucune position détenue.</p>}
        </section>
      </div>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Actifs de la catégorie</h2>
            <p>
              {estate
                ? 'Valeur nette = valeur brute détenue − capital restant dû'
                : 'Performance 30j : variation du prix de l’actif, selon les observations disponibles'}
            </p>
          </div>
        </div>
        <TableScroll label="Actifs de la catégorie">
          {estate ? (
            <table>
              <thead>
                <tr>
                  <th>Bien / usage</th>
                  <th>Détention</th>
                  <th className="num">Brut détenu</th>
                  <th className="num">Capital restant dû</th>
                  <th className="num" aria-sort="descending">
                    Valeur nette
                  </th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <Link className="strong" href={asset.href}>
                        {asset.name}
                      </Link>
                      <p className="small muted">{asset.realEstate?.description}</p>
                    </td>
                    <td>{asset.realEstate?.ownershipPercent} %</td>
                    <td className="num">
                      {categoryMoney(asset.realEstate?.grossValue ?? null, currency)}
                    </td>
                    <td className="num">
                      {categoryMoney(asset.realEstate?.debt ?? null, currency)}
                    </td>
                    <td className="num strong">{categoryMoney(asset.value, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="category-assets-table">
              <thead>
                <tr>
                  <th>Actif</th>
                  <th className="num">Quantité</th>
                  <th className="num">Prix actuel</th>
                  <th className="num" aria-sort="descending">
                    Valeur ({currency})
                  </th>
                  <th className="num">Performance 30j</th>
                  <th className="num">Plus-value latente</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => {
                  const gain = calculatePerformance(asset.value, asset.cost).absolute;
                  return (
                    <tr key={asset.id}>
                      <td>
                        <Link className="asset-cell strong" href={asset.href}>
                          {asset.name}
                        </Link>
                      </td>
                      <td className="num">
                        {asset.quantity === null
                          ? '—'
                          : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(
                              Number(asset.quantity),
                            )}
                      </td>
                      <td className="num">
                        {categoryMoney(
                          asset.price === null ? null : Number(asset.price),
                          asset.priceCurrency,
                        )}
                      </td>
                      <td className="num strong">{categoryMoney(asset.value, currency)}</td>
                      <td className={`num ${trendClass(asset.change30dPercent)}`}>
                        {categoryPercent(asset.change30dPercent, true)}
                      </td>
                      <td className={`num ${trendClass(gain)}`}>{signedMoney(gain, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableScroll>
        {!assets.length && (
          <div className="empty">
            <h3>Aucun actif détenu dans cette catégorie</h3>
            <Link className="btn primary" href="/assets/new">
              Ajouter un actif
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
