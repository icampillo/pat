'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { EvolutionChart } from './charts';
import { decimal as d } from '@/domain/money';
import type { AppState, SnapshotView } from '@/shared/types';
export function HistoryView({ state, currency }: { state: AppState; currency: 'EUR' | 'USD' }) {
  const [group, setGroup] = useState('all');
  const buckets = new Map<string, SnapshotView>();
  for (const snapshot of state.snapshots) {
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: state.portfolio.timezone }).format(
      new Date(snapshot.capturedAt),
    );
    const key =
      group === 'all'
        ? snapshot.id
        : group === 'day'
          ? local
          : group === 'month'
            ? local.slice(0, 7)
            : local.slice(0, 4);
    buckets.set(key, snapshot);
  }
  const rows = [...buckets.values()];
  const value = (s: SnapshotView) => (currency === 'EUR' ? s.totalEur : s.totalUsd);
  const money = (v: string | null) =>
    v === null
      ? '—'
      : new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(v));
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Valeurs enregistrées</h2>
          <p>{state.snapshots.length} captures affichées · les anciennes valeurs sont conservées</p>
        </div>
        <a className="btn" href="/api/v1/exports/history.csv">
          <Download size={16} />
          Exporter l’historique
        </a>
      </div>
      <div className="table-toolbar">
        <label>
          Regrouper l’historique
          <select
            aria-label="Regrouper l’historique"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">Toutes les captures</option>
            <option value="day">Par jour</option>
            <option value="month">Par mois</option>
            <option value="year">Par année</option>
          </select>
        </label>
        <p className="small muted">
          Dernière capture de chaque période. Les variations brutes incluent vos apports et
          retraits.
        </p>
      </div>
      {state.historyRevised && (
        <p className="error-note">
          Le journal contient des opérations rétroactives ou corrigées. Les anciennes captures
          restent inchangées ; la performance après flux n’est pas calculée sur cet historique.
        </p>
      )}
      <EvolutionChart
        points={rows.map((s) => ({
          date: s.capturedAt,
          value: value(s) === null ? null : Number(value(s)),
        }))}
        currency={currency}
      />
      <div className="table-scroll history-table">
        <table>
          <thead>
            <tr>
              <th>Date de capture</th>
              <th>Type</th>
              <th className="num">Valeur {currency}</th>
              <th className="num">Variation brute</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .map((s, i) => {
                const before = i > 0 ? value(rows[i - 1]) : null,
                  current = value(s);
                const delta =
                  before !== null && current !== null ? d(current).sub(before).toFixed(2) : null;
                return (
                  <tr key={s.id}>
                    <td>
                      {new Date(s.capturedAt).toLocaleString('fr-FR', {
                        timeZone: state.portfolio.timezone,
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>
                      <span className="tag">
                        {s.kind === 'SEED'
                          ? 'Démonstration'
                          : s.kind === 'DAILY'
                            ? 'Quotidien'
                            : s.kind === 'INVALIDATED'
                              ? 'Capture écartée'
                              : s.kind === 'IMPORT'
                                ? 'Import d’inventaire'
                                : s.kind === 'WALLET'
                                  ? 'Wallet / DeBank'
                                  : 'Manuel'}
                      </span>
                    </td>
                    <td className="num strong">{money(current)}</td>
                    <td
                      className={`num ${delta !== null && d(delta).lt(0) ? 'negative' : 'positive'}`}
                    >
                      {delta !== null && d(delta).gte(0) ? '+' : ''}
                      {money(delta)}
                    </td>
                  </tr>
                );
              })
              .reverse()}
          </tbody>
        </table>
      </div>
    </section>
  );
}
