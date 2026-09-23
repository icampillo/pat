'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Plus, RefreshCw, Wallet, KeyRound, Pause, Play, Trash2 } from 'lucide-react';
import type { AppState } from '@/shared/types';
import type { WalletToken } from '@/shared/wallets';
import { walletErrors, positionLabels } from '@/shared/wallets';
import { decimal as d } from '@/domain/money';
import { showWalletValue } from '@/domain/wallet-display';
import type { SaveAction } from './forms';
import { Confirm } from './ui/confirm';

const usd = (value: string | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(Number(value));
const qty = (value: string | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 10 }).format(Number(value));
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : 'Jamais';

export function WalletAutoRefresh({ state }: { state: AppState }) {
  const router = useRouter();
  const enabled = state.onchain.config.enabled && state.onchain.wallets.some((w) => w.enabled);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [enabled, router]);
  return null;
}

export function DeBankSettings({ state, save }: { state: AppState; save: SaveAction }) {
  const config = state.onchain.config;
  const [mode, setMode] = useState(config.mode);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <section className="panel detail-panel" id="debank">
      <div className="wallet-title">
        <KeyRound size={20} />
        <h2>Connexion DeBank</h2>
      </div>
      <p className="muted">
        {mode === 'PUBLIC'
          ? 'Lecture gratuite du profil public : ajoutez une adresse, aucune clé ni inscription requise.'
          : config.hasKey
            ? 'Clé API enregistrée et chiffrée sur le serveur.'
            : 'Mode avancé : l’API officielle nécessite une clé et des crédits DeBank Cloud.'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          setBusy(true);
          setMessage('');
          try {
            await save('debank/config', 'PATCH', {
              mode,
              ...(String(fd.get('key') || '').trim()
                ? { accessKey: String(fd.get('key')).trim() }
                : {}),
              intervalMinutes: Number(fd.get('interval')),
              enabled: fd.get('enabled') === 'on',
            });
            const keyInput = form.elements.namedItem('key') as HTMLInputElement | null;
            if (keyInput) keyInput.value = '';
            setMessage(
              'Configuration enregistrée. Les adresses actives seront synchronisées automatiquement.',
            );
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Mode de récupération
          <select value={mode} onChange={(e) => setMode(e.target.value as 'PUBLIC' | 'API')}>
            <option value="PUBLIC">Gratuit · profil public DeBank</option>
            <option value="API">API officielle · clé et crédits</option>
          </select>
        </label>
        {mode === 'API' && (
          <label>
            Clé API DeBank Cloud
            <input
              name="key"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={512}
              required={!config.hasKey}
              placeholder={
                config.hasKey ? 'Laisser vide pour conserver la clé' : 'Votre AccessKey DeBank'
              }
            />
          </label>
        )}
        <label>
          Fréquence de synchronisation
          <select name="interval" defaultValue={config.intervalMinutes}>
            <option value="15">Toutes les 15 minutes</option>
            <option value="60">Toutes les heures</option>
            <option value="240">Toutes les 4 heures</option>
          </select>
        </label>
        <label className="wallet-check">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={config.configured ? config.enabled : true}
          />
          Synchronisation automatique active
        </label>
        <p className="small muted">
          {mode === 'PUBLIC'
            ? 'Une lecture du profil par synchronisation, sans frais API. La précision et la fraîcheur sont celles affichées par DeBank.'
            : '3 requêtes API par adresse et par synchronisation ; crédits DeBank Cloud nécessaires.'}{' '}
          La synchronisation continue tant que le serveur de l’application fonctionne, même avec le
          navigateur fermé.
        </p>
        <div className="wallet-actions">
          <button className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer DeBank'}
          </button>
          {mode === 'API' && (
            <a
              className="text-link"
              href="https://cloud.debank.com"
              target="_blank"
              rel="noreferrer"
            >
              DeBank Cloud <ExternalLink size={14} />
            </a>
          )}
        </div>
      </form>
      {message && (
        <p role="status" className="wallet-message">
          {message}
        </p>
      )}
      {config.hasKey && (
        <Confirm
          title="Supprimer la clé DeBank ?"
          description="Les synchronisations s’arrêtent. Les adresses et les dernières observations restent conservées."
          onConfirm={async () => {
            try {
              await save('debank/config', 'DELETE', {});
            } catch (error) {
              setMessage((error as Error).message);
            }
          }}
        >
          <button className="text-link wallet-remove">Supprimer la clé enregistrée</button>
        </Confirm>
      )}
    </section>
  );
}

export function WalletSummary({ state, currency }: { state: AppState; currency: 'EUR' | 'USD' }) {
  const { onchain } = state;
  if (!onchain.wallets.length)
    return (
      <section className="panel wallet-summary">
        <div>
          <h2>Vos cryptos, automatiquement</h2>
          <p className="muted">
            Ajoutez une adresse pour suivre les soldes, le staking et la DeFi avec DeBank.
          </p>
        </div>
        <Link className="btn" href="/wallets">
          <Wallet size={16} />
          Connecter une adresse
        </Link>
      </section>
    );
  const value = currency === 'EUR' ? onchain.valueEur : onchain.valueUsd;
  return (
    <section className="panel wallet-summary">
      <div>
        <h2>Wallets & DeFi</h2>
        <p className="muted">
          {onchain.includedCount} adresse(s) incluse(s) ·{' '}
          {onchain.staleCount ? 'Dernières valeurs connues à actualiser' : 'Source DeBank'} · Coût
          d’achat inconnu
        </p>
      </div>
      <strong>
        {value === null
          ? 'En attente de valorisation'
          : new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(value))}
      </strong>
      <Link className="btn" href="/wallets">
        Voir les positions <ExternalLink size={14} />
      </Link>
    </section>
  );
}

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

export function WalletsPage({ state, save }: { state: AppState; save: SaveAction }) {
  const params = useSearchParams();
  const { wallets, config } = state.onchain;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState('all'),
    [chain, setChain] = useState('all'),
    [search, setSearch] = useState(''),
    [showSmall, setShowSmall] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
      .filter((p) =>
        matches(`${p.protocol} ${p.kind} ${p.supplies.map((t) => t.symbol).join(' ')}`, p.chain) &&
        showWalletValue(p.netUsd, eurUsd, showSmall, p.valueText),
      )
      .map((p) => ({ ...p, key: `${w.id}:${p.id}`, wallet: w.label })),
  );
  return (
    <>
      {!wallets.length && config.mode === 'PUBLIC' && (
        <div className="notice">
          Mode gratuit prêt. Ajoutez votre adresse : la lecture DeBank démarre automatiquement, sans
          clé API.
        </div>
      )}
      <section className="panel detail-panel wallet-add">
        <h2>Ajouter une adresse</h2>
        <p className="muted">
          Les réseaux compatibles et les protocoles DeFi sont détectés par DeBank. Aucun
          portefeuille à connecter ni signature à fournir.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            void run(async () => {
              await save('wallets', 'POST', {
                address: fd.get('address'),
                label: fd.get('label'),
                included: fd.get('included') === 'on',
                ...(fd.get('reference') ? { referenceUsd: fd.get('reference') } : {}),
              });
              form.reset();
            });
          }}
        >
          <div className="wallet-form-grid">
            <label>
              Adresse publique ou profil DeBank
              <input
                name="address"
                required
                maxLength={250}
                placeholder="0x… ou https://debank.com/profile/…"
                defaultValue={params.get('address') || ''}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label>
              Nom du wallet (facultatif)
              <input name="label" maxLength={80} placeholder="Mon wallet principal" />
            </label>
          </div>
          <details>
            <summary className="text-link">Options de suivi et de comparaison</summary>
            <label>
              Valeur de référence en dollars (facultatif)
              <input
                name="reference"
                type="number"
                min="0"
                max="999999999999999"
                step="0.01"
                defaultValue={params.get('reference') || ''}
                placeholder="Montant observé sur DeBank"
              />
            </label>
            <p className="small muted">
              Repère de comparaison uniquement : il ne remplace jamais la valeur récupérée.
            </p>
          </details>
          <label className="wallet-check">
            <input name="included" type="checkbox" defaultChecked />
            Inclure cette adresse dans le patrimoine
          </label>
          <p className="small muted">
            Les actifs déjà saisis manuellement restent comptés. Excluez ce wallet du total si ses
            positions sont déjà représentées dans vos saisies.
          </p>
          <button className="btn primary" disabled={busy}>
            <Plus size={16} />
            Ajouter le wallet
          </button>
        </form>
      </section>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {config.configured && (
        <div className="wallet-source">
          <span className="tag">
            DeBank {config.mode === 'PUBLIC' ? 'gratuit' : 'API'} ·{' '}
            {config.enabled ? `Automatique · ${config.intervalMinutes} min` : 'En pause'}
          </span>
          <Link href="/settings#debank" className="text-link">
            Configurer la source
          </Link>
        </div>
      )}
      {wallets.length > 0 && (
        <>
          <div className="wallet-cards">
            {wallets.map((w) => (
              <section className="panel wallet-card" key={w.id}>
                <div className="wallet-card-top">
                  <span className="asset-avatar">
                    <Wallet size={20} />
                  </span>
                  <div>
                    <h2>{w.label}</h2>
                    <a
                      className="wallet-address"
                      href={`https://debank.com/profile/${w.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {w.address}
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
                <strong className="wallet-balance">{usd(w.data?.totalUsd ?? null)}</strong>
                {w.data?.source === 'DEBANK_PUBLIC' && (
                  <p className="small muted">
                    Lecture publique · total arrondi par DeBank
                    <br />
                      Fraîcheur indiquée au relevé : {w.data.updatedLabel}
                  </p>
                )}
                <p className="small muted">
                  Total net DeBank ·{' '}
                  {w.included ? 'Inclus dans le patrimoine' : 'Exclu du patrimoine'}
                </p>
                <p className="small">
                  {!config.configured
                    ? 'En attente de votre clé API'
                    : !w.enabled || !config.enabled
                      ? 'Synchronisation en pause'
                      : w.status === 'SYNCING'
                        ? 'Synchronisation en cours…'
                        : w.status === 'ERROR'
                          ? walletErrors[w.errorCode || 'NETWORK'] || walletErrors.NETWORK
                          : !w.data
                            ? 'Première synchronisation programmée…'
                            : w.stale
                              ? 'Données anciennes · dernière valeur conservée'
                              : 'Synchronisé avec DeBank'}
                </p>
                <p className="small muted">
                  Dernière réussite : {date(w.lastSuccessAt)}
                  {config.enabled && w.enabled && <> · Prochaine : {date(w.nextSyncAt)}</>}
                </p>
                {!!w.data?.warnings?.length && (
                  <details>
                    <summary className="small">Détails partiels ({w.data.warnings.length})</summary>
                    <ul className="small">
                      {w.data.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {w.referenceUsd !== null && (
                  <div className="wallet-reference">
                    <span>
                      Repère saisi : {usd(w.referenceUsd)} · {date(w.referenceAt)}
                    </span>
                    <strong>
                      {w.data
                        ? `Écart actuel : ${usd(d(w.data.totalUsd).sub(w.referenceUsd).toFixed())}`
                        : 'Comparaison après synchronisation'}
                    </strong>
                    <span>
                      Variation de marché et décalage de mise à jour possibles. Cet écart n’est pas
                      une plus-value.
                    </span>
                  </div>
                )}
                <div className="wallet-actions">
                  <button
                    className="btn"
                    disabled={busy || !config.enabled || !w.enabled || w.status === 'SYNCING'}
                    onClick={() => run(() => save(`wallets/${w.id}/sync`, 'POST', {}))}
                  >
                    <RefreshCw size={14} />
                    Actualiser
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      run(() => save(`wallets/${w.id}`, 'PATCH', { enabled: !w.enabled }))
                    }
                  >
                    {w.enabled ? <Pause size={14} /> : <Play size={14} />}
                    {w.enabled ? 'Pause' : 'Reprendre'}
                  </button>
                  <Confirm
                    title="Retirer cette adresse ?"
                    description="Elle sera exclue du patrimoine et ne sera plus synchronisée. Les captures historiques sont conservées."
                    onConfirm={() => run(() => save(`wallets/${w.id}`, 'DELETE', {}))}
                  >
                    <button className="icon-btn" aria-label={`Retirer ${w.label}`} disabled={busy}>
                      <Trash2 size={16} />
                    </button>
                  </Confirm>
                </div>
                <label className="wallet-check">
                  <input
                    type="checkbox"
                    checked={w.included}
                    disabled={busy}
                    onChange={(e) =>
                      run(() => save(`wallets/${w.id}`, 'PATCH', { included: e.target.checked }))
                    }
                  />
                  Compter dans le patrimoine
                </label>
              </section>
            ))}
          </div>
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
                        empty={p.supplies.length && !showSmall ? 'Valeurs inférieures à 1 € masquées.' : `Actifs : ${usd(p.assetsUsd)} · détail non fourni`}
                      />
                    </div>
                    <div>
                      <h4>Emprunts</h4>
                      <TokenList
                        tokens={p.borrows.filter(showToken)}
                        empty={p.borrows.length && !showSmall ? 'Valeurs inférieures à 1 € masquées.' : d(p.debtUsd).isZero() ? 'Aucun' : usd(p.debtUsd)}
                      />
                    </div>
                    <div>
                      <h4>Récompenses</h4>
                      <TokenList tokens={p.rewards.filter(showToken)} empty={p.rewards.length && !showSmall ? 'Valeurs inférieures à 1 € masquées.' : 'Aucune indiquée'} />
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
            Le mode gratuit reprend les montants affichés par DeBank, parfois arrondis ou inférieurs
            à un centime. Les données restent limitées à la couverture DeBank. Les prix nuls sont
            affichés comme indisponibles. Les NFT individuels, l’historique des transactions et les
            coûts d’achat ne sont pas importés. Les montants de cette page sont en dollars.
          </p>
        </>
      )}
    </>
  );
}
