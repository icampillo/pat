'use client';
import type { AssetView } from '@/shared/types';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { AssetAvatar, Empty, money, qty, Signed } from '@/components/workspace/display';
export function AssetTable({ rows, currency }: { rows: AssetView[]; currency: 'EUR' | 'USD' }) {
  const val = (a: AssetView) => (currency === 'EUR' ? a.valueEur : a.valueUsd);
  const gain = (a: AssetView) => (currency === 'EUR' ? a.gainEur : a.gainUsd);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Actif</th>
            <th>Catégorie</th>
            <th className="num">Quantité</th>
            <th className="num">Prix actuel</th>
            <th className="num">Valeur</th>
            <th className="num">Plus-value latente</th>
            <th>
              <span className="sr-only">Détail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <Link href={`/assets/${a.id}`} className="asset-cell">
                  <AssetAvatar asset={a} />
                  <span>
                    <strong>{a.name}</strong>
                    {(a.symbol !== a.name || a.status === 'ARCHIVED') && (
                      <small>
                        {a.symbol !== a.name ? a.symbol : ''}
                        {a.status === 'ARCHIVED' ? ' · Archivé' : ''}
                      </small>
                    )}
                  </span>
                </Link>
              </td>
              <td>
                <span
                  className="category-pill"
                  style={{ color: a.category.color, background: `${a.category.color}10` }}
                >
                  {a.category.label}
                </span>
              </td>
              <td className="num">{qty(a.quantity)}</td>
              <td className="num">
                {money(a.price, a.currency)}
                {a.stale && a.price && <small className="muted">Prix ancien</small>}
              </td>
              <td className="num strong">
                {money(val(a), currency)}
                {a.category.key === 'REAL_ESTATE' && <small className="muted">Valeur nette</small>}
              </td>
              <td className="num">
                <Signed value={gain(a)} currency={currency} />
              </td>
              <td>
                <Link
                  className="icon-link"
                  href={`/assets/${a.id}`}
                  aria-label={`Ouvrir ${a.name}`}
                >
                  <ChevronRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          title="Aucun actif pour le moment"
          text="Ajoutez un actif et sa quantité pour commencer."
          href="/assets/new"
          label="Ajouter un actif"
        />
      )}
    </div>
  );
}
