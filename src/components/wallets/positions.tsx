'use client';
import { decimal as d } from '@/domain/money';
import { showWalletValue } from '@/domain/wallet-display';
import type { AppState } from '@/shared/types';
import type { WalletToken } from '@/shared/wallets';
import { positionLabels } from '@/shared/wallets';
import { useState } from 'react';

import { date, qty, usd } from './format';
function TokenList({ tokens, empty }: { tokens: WalletToken[]; empty: string }) {
  return tokens.length ? (
    <ul className="wallet-token-list">
      {tokens.map((t, i) => (
        <li key={`${t.id}:${i}`}>
          <span>
            {qty(t.amount)} <strong>{t.symbol}</strong>
          </span>
          <span className="muted">{t.valueText || usd(t.valueUsd)}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="small muted">{empty}</p>
  );
}

export function WalletPositions({ state }: { state: AppState }) {
  const { wallets } = state.onchain;
  const [selected, setSelected] = useState('all'),
    [chain, setChain] = useState('all'),
    [search, setSearch] = useState(''),
    [showSmall, setShowSmall] = useState(false);
  const chosen = wallets.filter((w) => selected === 'all' || w.id === selected);
  const data = chosen.flatMap((w) => (w.data ? [w.data] : []));
  const total =
    chosen.length && chosen.every((w) => w.data)
      ? data.reduce((s, w) => s.add(w.totalUsd), d(0)).toFixed()
      : null;
  const sum = (key: 'defiUsd' | 'debtUsd' | 'rewardsUsd') =>
    data.length ? data.reduce((s, w) => s.add(w[key]), d(0)).toFixed() : null;
  const chains = [
    ...new Map(
      data.flatMap((w) =>
        w.chains.filter((c) => !d(c.valueUsd).isZero()).map((c) => [c.id, c.name] as const),
      ),
    ).entries(),
  ];
  const matches = (value: string, id: string) =>
    (chain === 'all' || chain === id) && value.toLowerCase().includes(search.toLowerCase());
  const eurUsd = state.fxRate?.eurUsd || null;
  const showToken = (token: WalletToken) =>
    showWalletValue(token.valueUsd, eurUsd, showSmall, token.valueText);
  const tokens = chosen.flatMap((w) =>
    (w.data?.tokens || [])
      .filter((t) => matches(`${t.name} ${t.symbol}`, t.chain) && showToken(t))
      .map((t, i) => ({ ...t, key: `${w.id}:${i}`, wallet: w.label })),
  );
  const positions = chosen.flatMap((w) =>
    (w.data?.positions || [])
      .filter(
        (p) =>
          matches(
            `${p.protocol} ${p.kind} ${p.supplies.map((t) => t.symbol).join(' ')}`,
            p.chain,
          ) && showWalletValue(p.netUsd, eurUsd, showSmall, p.valueText),
      )
      .map((p) => ({ ...p, key: `${w.id}:${p.id}`, wallet: w.label })),
  );
  return (
    <>
      {' '}
      <div className="wallet-filters">
        <label>
          Wallet
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setChain('all');
            }}
          >
            <option value="all">Toutes les adresses</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Réseau
          <select value={chain} onChange={(e) => setChain(e.target.value)}>
            <option value="all">Tous les réseaux</option>
            {chains.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rechercher un token ou protocole
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ETH, Aave, Lido…"
          />
        </label>
      </div>
      <label className="wallet-check wallet-small-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={showSmall}
          onChange={(event) => setShowSmall(event.target.checked)}
        />
        Afficher les valeurs de moins de 1 €
      </label>
      <p className="small muted wallet-filter-note">
        Ce filtre masque seulement les lignes ; les totaux DeBank ne changent pas.
        {!eurUsd && ' Taux EUR/USD indisponible : toutes les lignes restent visibles.'}
      </p>
      <div className="metrics">
        {[
          {
            title: 'Total net DeBank',
            value: total,
            note: 'Solde DeBank des adresses sélectionnées',
          },
          {
            title: 'Positions DeFi nettes',
            value: sum('defiUsd'),
            note: 'Staking, pools, prêts · dettes déduites',
          },
          {
            title: 'Dettes',
            value: sum('debtUsd'),
            note: 'Déjà déduites des positions nettes',
          },
          {
            title: 'Récompenses',
            value: sum('rewardsUsd'),
            note: 'Détail des positions · non ajouté au total',
          },
        ].map((m) => (
          <section className="metric" key={m.title}>
            <div className="metric-top">{m.title}</div>
            <strong>{usd(m.value)}</strong>
            <p>{m.note}</p>
          </section>
        ))}
      </div>
      {data.some((w) => d(w.reconciliationUsd).abs().gte('0.01')) && (
        <p className="notice">
          Écart entre le total DeBank et les détails :{' '}
          {usd(data.reduce((s, w) => s.add(w.reconciliationUsd), d(0)).toFixed())}. Les requêtes
          peuvent refléter des instants ou des couvertures différents. Le patrimoine utilise le
          total net DeBank.
        </p>
      )}
      <section className="panel">
        <div className="section-title">
          <h2>Tokens en wallet</h2>
          <span className="tag">{tokens.length} ligne(s)</span>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Tokens du wallet">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Réseau</th>
                <th>Wallet</th>
                <th className="num">Quantité</th>
                <th className="num">Prix USD</th>
                <th className="num">Valeur USD</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.key}>
                  <td>
                    <strong>{t.symbol}</strong>
                    <div className="small muted">{t.name}</div>
                  </td>
                  <td>{t.chain}</td>
                  <td>{t.wallet}</td>
                  <td className="num">{qty(t.amount)}</td>
                  <td className="num">{usd(t.priceUsd)}</td>
                  <td className="num strong">{t.valueText || usd(t.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!tokens.length && (
          <p className="empty-inline">
            {data.length
              ? 'Aucun token pour cette sélection.'
              : 'Vos tokens apparaîtront après la première synchronisation.'}
          </p>
        )}
      </section>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Staking & positions DeFi</h2>
            <p>Positions détectées par DeBank · tous les protocoles compatibles</p>
          </div>
          <span className="tag">{positions.length} position(s)</span>
        </div>
        <div className="defi-positions">
          {positions.map((p) => (
            <article key={p.key} className="defi-position">
              <div className="wallet-source">
                <div>
                  <h3>{p.protocol}</h3>
                  <p className="small muted">
                    {p.chain} · {p.wallet}
                  </p>
                </div>
                <span className="tag">{positionLabels[p.kind] || p.kind}</span>
                <strong>{p.valueText || `${p.approximate ? '≈ ' : ''}${usd(p.netUsd)}`}</strong>
              </div>
              {p.description && <p className="small muted">{p.description}</p>}
              <div className="defi-columns">
                <div>
                  <h4>Actifs déposés</h4>
                  <TokenList
                    tokens={p.supplies.filter(showToken)}
                    empty={
                      p.supplies.length && !showSmall
                        ? 'Valeurs inférieures à 1 € masquées.'
                        : `Actifs : ${usd(p.assetsUsd)} · détail non fourni`
                    }
                  />
                </div>
                <div>
                  <h4>Emprunts</h4>
                  <TokenList
                    tokens={p.borrows.filter(showToken)}
                    empty={
                      p.borrows.length && !showSmall
                        ? 'Valeurs inférieures à 1 € masquées.'
                        : d(p.debtUsd).isZero()
                          ? 'Aucun'
                          : usd(p.debtUsd)
                    }
                  />
                </div>
                <div>
                  <h4>Récompenses</h4>
                  <TokenList
                    tokens={p.rewards.filter(showToken)}
                    empty={
                      p.rewards.length && !showSmall
                        ? 'Valeurs inférieures à 1 € masquées.'
                        : 'Aucune indiquée'
                    }
                  />
                </div>
              </div>
              <p className="small muted">
                {p.observedAt
                  ? `Observation DeBank : ${date(p.observedAt)}`
                  : 'Données du profil public · valeurs arrondies'}
                {p.unlockAt && ` · Déverrouillage : ${date(p.unlockAt)}`}
              </p>
            </article>
          ))}
        </div>
        {!positions.length && (
          <p className="empty-inline">
            {data.length
              ? 'Aucune position DeFi pour cette sélection.'
              : 'Vos positions apparaîtront après la première synchronisation.'}
          </p>
        )}
      </section>
      <p className="small muted wallet-footnote">
        Le mode gratuit reprend les montants affichés par DeBank, parfois arrondis ou inférieurs à
        un centime. Les données restent limitées à la couverture DeBank. Les prix nuls sont affichés
        comme indisponibles. Les NFT individuels, l’historique des transactions et les coûts d’achat
        ne sont pas importés. Les montants de cette page sont en dollars.
      </p>
    </>
  );
}
