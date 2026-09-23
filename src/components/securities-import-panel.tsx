'use client';
import { useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import type { SaveAction } from './forms';
import type { SecuritiesPreview } from '@/server/securities-import';
import { categoryMoney } from './asset-category-card';

export function SecuritiesImportPanel({ save }: { save: SaveAction }) {
  const [csv, setCsv] = useState(''),
    [platform, setPlatform] = useState('BoursoBank'),
    [boursoCurrency, setCurrency] = useState('EUR');
  const [preview, setPreview] = useState<SecuritiesPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const reset = () => {
    setPreview(null);
    setMessage('');
    setError('');
  };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel detail-panel securities-import" id="import-bourse">
      <div className="securities-import-heading">
        <div>
          <h2>Importer mes positions Bourse</h2>
          <p className="muted">
            Déposez l’export « Positions instantanées » de BoursoBank. Les produits, quantités,
            coûts d’acquisition et cours sont récupérés automatiquement.
          </p>
        </div>
        <Upload size={22} aria-hidden="true" />
      </div>
      <div className="form-grid">
        <label>
          Compte / courtier
          <input
            value={platform}
            disabled={busy}
            maxLength={120}
            onChange={(event) => {
              setPlatform(event.target.value);
              reset();
            }}
          />
          <small>Distinguez vos comptes, par exemple BoursoBank PEA et BoursoBank CTO.</small>
        </label>
        <label>
          Devise du relevé Bourso
          <select
            value={boursoCurrency}
            disabled={busy}
            onChange={(event) => {
              setCurrency(event.target.value);
              reset();
            }}
          >
            <option value="EUR">EUR · Euro</option>
            <option value="USD">USD · Dollar américain</option>
          </select>
          <small>L’export Bourso ne contient pas de colonne de devise.</small>
        </label>
        <label className="full">
          Fichier CSV Bourse
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (event) => {
              reset();
              setCsv('');
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 200_000) {
                setError('Fichier limité à 200 Ko.');
                return;
              }
              setCsv(await file.text());
            }}
          />
          <small>
            100 positions maximum · séparateur point-virgule ou virgule · décimales françaises
            acceptées.
          </small>
        </label>
      </div>
      <div className="heading-actions">
        <button
          className="btn primary"
          disabled={busy || !csv || !platform.trim()}
          onClick={() =>
            run(async () => {
              setPreview(null);
              setPreview(
                (await save('securities/imports/preview', 'POST', {
                  csv,
                  platform,
                  boursoCurrency,
                })) as SecuritiesPreview,
              );
            })
          }
        >
          <Upload size={16} />
          {busy ? 'Traitement en cours…' : 'Analyser le CSV Bourse'}
        </button>
        <a className="text-link" href="/import-bourse.csv" download>
          Modèle CSV générique
        </a>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = (await save('securities/refresh', 'POST', {})) as {
                prices: number;
                failures: { symbol: string; message: string }[];
              };
              setMessage(
                `${result.prices} nouveau(x) cours enregistré(s).${result.failures.length ? ` ${result.failures.map((item) => `${item.symbol} : ${item.message}`).join(' ')}` : ' Les autres cours sont déjà à jour.'}`,
              );
            })
          }
        >
          <RefreshCw size={16} />
          Actualiser les cours Bourse
        </button>
      </div>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {preview && (
        <>
          <h3>
            Aperçu Bourse · {preview.rows.filter((row) => !row.existingAssetId).length} position(s)
            à créer
          </h3>
          {!!preview.errors.length && (
            <ul className="error-note" role="alert">
              {preview.errors.map((item, index) => (
                <li key={index}>
                  {item.line ? `Ligne ${item.line} : ` : ''}
                  {item.message}
                </li>
              ))}
            </ul>
          )}
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Aperçu de l’import Bourse"
          >
            <table>
              <thead>
                <tr>
                  <th>Produit identifié</th>
                  <th>Cotation</th>
                  <th className="num">Quantité</th>
                  <th className="num">Coût total</th>
                  <th className="num">Cours récupéré</th>
                  <th>Import</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line}>
                    <td className="strong">
                      {row.quote.name}
                      <small className="muted">{row.isin || row.ticker}</small>
                    </td>
                    <td>
                      {row.quote.symbol}
                      <small className="muted">{row.quote.exchange}</small>
                    </td>
                    <td className="num">{row.quantity}</td>
                    <td className="num">
                      {categoryMoney(
                        row.acquisitionCost === null ? null : Number(row.acquisitionCost),
                        row.costCurrency || row.quote.currency,
                      )}
                    </td>
                    <td className="num">
                      {categoryMoney(Number(row.quote.price), row.quote.currency)}
                      <small className="muted">
                        {new Date(row.quote.observedAt).toLocaleString('fr-FR')}
                      </small>
                    </td>
                    <td>{row.existingAssetId ? 'Déjà présente · ignorée' : 'Nouvelle position'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Vérifiez les produits et leur place de cotation. Les lignes Bourso utilisent la
            valorisation moins la plus-value pour conserver le coût malgré l’arrondi du PRU. Aucune
            position n’est créée avant confirmation.
          </p>
          <button
            className="btn primary"
            disabled={busy || preview.errors.length > 0 || !preview.rows.length}
            onClick={() =>
              run(async () => {
                const result = (await save(`securities/imports/${preview.id}/confirm`, 'POST', {
                  confirmed: true,
                })) as { created: number; skipped: number };
                setMessage(
                  `Import terminé : ${result.created} position(s) créée(s), ${result.skipped} déjà présente(s). Les cours seront actualisés automatiquement.`,
                );
                setPreview(null);
                setCsv('');
              })
            }
          >
            Confirmer l’import Bourse
          </button>
        </>
      )}
      <p className="small muted">
        Cours Yahoo Finance, actualisés toutes les 15 minutes tant que le serveur fonctionne. Ils
        peuvent être différés selon la place ; le dernier cours connu est conservé en cas
        d’indisponibilité. L’import ajoute les positions absentes sans remplacer celles déjà
        suivies.
      </p>
    </section>
  );
}
