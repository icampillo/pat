'use client';
import type { AppState } from '@/shared/types';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { AssetTable } from './asset-table';
export function AssetList({ state, currency }: { state: AppState; currency: 'EUR' | 'USD' }) {
  const [category, setCategory] = useState('all'),
    [search, setSearch] = useState('');
  const shown = state.rows.filter(
    (a) =>
      !a.deletedAt &&
      (category === 'all' || a.categoryId === category) &&
      `${a.name} ${a.symbol}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filters = (
    <div className="table-toolbar">
      <div className="search">
        <Search size={17} />
        <input
          aria-label="Rechercher un actif"
          placeholder="Rechercher un actif…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <select
        aria-label="Filtrer par catégorie"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="all">Toutes les catégories</option>
        {state.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <span className="muted small">{shown.length} actifs</span>
    </div>
  );
  return (
    <section className="panel">
      {filters}
      <AssetTable rows={shown} currency={currency} />
    </section>
  );
}
