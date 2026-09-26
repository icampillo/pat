'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
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

const colors = ['#6556dc', '#218a89', '#b7791f', '#bb5695', '#507da8', '#849267'];
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
  const { category, assets } = details;
  const estate = category.realEstate;
  const points = filterCategoryHistory(details.history, period, asOf);
  const slices = assets
    .map((asset, index) => ({
      name: asset.name,
      value: asset.value!,
      color: colors[index % colors.length],
    }))
    .filter((slice) => slice.value !== null && slice.value > 0);
  const incomplete = category.totalValue === null;
  const negativeValues = assets.some((asset) => asset.value !== null && asset.value < 0);
  return (
    <>
      <Link className="text-link category-back" href="/dashboard">
        <ArrowLeft size={16} /> Tableau de bord
      </Link>
      {estate && (
        <div className="heading-actions">
          <Link className="btn primary" href="/assets/new?category=REAL_ESTATE">
            Ajouter un bien
          </Link>
        </div>
      )}
      <div className="metrics category-metrics">
        <section className="metric">
          <div className="metric-top">{estate ? 'Valeur nette immobilière' : 'Valeur totale'}</div>
          <strong>{categoryMoney(category.totalValue, currency)}</strong>
          <p>
            {category.assetCount} {estate ? 'bien' : 'position'}
            {category.assetCount > 1 ? 's' : ''}
            {incomplete ? ' · valorisation incomplète' : ''}
          </p>
        </section>
        <section className="metric">
          <div className="metric-top">
            {estate ? 'Évolution de l’equity sur 30 jours' : 'Performance 30 jours'}
          </div>
          <Performance30d category={category} currency={currency} />
          <p>
            {category.baselineDate
              ? `Snapshot du ${new Date(category.baselineDate).toLocaleDateString('fr-FR')}`
              : 'Historique indisponible'}
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
          <div className="metric-top">{estate ? 'Dette immobilière' : 'Plus-value latente'}</div>
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
          <EvolutionChart points={points} currency={currency} label={category.name} />
          <p className="chart-foot">Snapshots conservés et valeur actuelle · {currency}</p>
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
                <span className="dot" style={{ background: colors[index % colors.length] }} />
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
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Actifs de la catégorie"
        >
          {estate ? (
            <table>
              <thead>
                <tr>
                  <th>Bien / usage</th>
                  <th>Détention</th>
                  <th className="num">Brut détenu</th>
                  <th className="num">Dette</th>
                  <th className="num">Valeur nette</th>
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
            <table>
              <thead>
                <tr>
                  <th>Actif</th>
                  <th className="num">Quantité</th>
                  <th className="num">Prix actuel</th>
                  <th className="num">Valeur ({currency})</th>
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
        </div>
        {!assets.length && (
          <div className="empty">
            <h3>Aucun actif détenu dans cette catégorie</h3>
            <Link className="btn primary" href="/assets/new">
              Ajouter un actif
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
