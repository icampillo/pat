'use client';
import { sortByValue, valueInEur } from '@/domain/value-sort';
import { errorMessage } from '@/shared/errors';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { ImportPreview } from '@/server/imports';
import type { SaveAction } from './forms';
import { typeLabels } from '@/shared/schemas';

const labels = {
  EXISTING: 'Déjà connue',
  NEW: 'Nouvelle',
  CHANGED: 'Potentiellement modifiée',
  AMBIGUOUS: 'À vérifier',
};
const fieldLabels: Record<string, string> = {
  assetId: 'Actif',
  platform: 'Compte',
  occurredAt: 'Date',
  type: 'Opération',
  quantity: 'Quantité',
  unitPrice: 'Prix unitaire',
  amount: 'Montant brut',
  fees: 'Frais',
  currency: 'Devise',
  settlement: 'Règlement',
  destination: 'Destination',
};
export function ImportSummary({ preview }: { preview: ImportPreview }) {
  return (
    <div role="status">
      <h3>
        {preview.rows.length +
          preview.errors.filter((e) => e.line > 0 && !preview.rows.some((r) => r.line === e.line))
            .length}{' '}
        lignes analysées
      </h3>
      <p>
        ✓ {preview.summary.EXISTING} transactions déjà connues · + {preview.summary.NEW} nouvelles
        transactions
      </p>
      <p>
        ↻ {preview.summary.CHANGED} potentiellement modifiées · ⚠ {preview.summary.AMBIGUOUS} à
        vérifier
      </p>
      <p className="muted">
        {preview.summary.reinforced} positions avec de nouvelles opérations ·{' '}
        {preview.summary.newPositions} nouvelles positions
      </p>
    </div>
  );
}
export function ImportPanel({
  save,
  eurUsd,
  accounts = [],
}: {
  save: SaveAction;
  eurUsd: string | null;
  accounts?: { id: string; name: string }[];
}) {
  const [csv, setCsv] = useState(''),
    [pdfBase64, setPdfBase64] = useState(''),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [accountId, setAccountId] = useState('');
  const [listings, setListings] = useState<Record<string, string>>({});
  const [source, setSource] = useState('GENERIC'),
    [platform, setPlatform] = useState(''),
    [currency, setCurrency] = useState('EUR');
  const [decisions, setDecisions] = useState<Record<number, 'IGNORE' | 'CREATE'>>({});
  const running = useRef(false);
  const reset = () => {
    setPreview(null);
    setDecisions({});
    setMessage('');
    setError('');
  };
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const count =
    (preview?.summary.NEW || 0) + Object.values(decisions).filter((d) => d === 'CREATE').length;
  return (
    <section className="panel detail-panel import-panel" id="import-transactions">
      <h2>Importer mes nouvelles opérations</h2>
      <p className="muted">
        Ajoutez vos nouveaux avis d’opéré Bourso (PDF) ou un CSV de transactions. Les opérations
        connues sont ignorées et les nouvelles renforcent les positions existantes.
      </p>
      <p className="small muted">
        Si vos positions initiales sont déjà enregistrées, importez uniquement les opérations qui ne
        sont pas incluses dans cet inventaire. Un relevé de positions n’est pas un avis d’opéré. Les
        montants sont bruts, les frais séparés. Un ISIN et un nom permettent de créer une nouvelle
        fiche Bourse avec une cotation vérifiée ; une cotation inconnue bloque la création, et
        plusieurs cotations nécessitent votre sélection.
      </p>
      <a className="text-link" href="/import-transactions.csv" download>
        Télécharger le modèle CSV
      </a>
      <div className="form-grid">
        <label>
          Source
          <select
            value={source}
            disabled={busy}
            onChange={(e) => {
              setSource(e.target.value);
              reset();
            }}
          >
            <option value="GENERIC">CSV générique / ancien import</option>
            <option value="BOURSORAMA">Boursorama / BoursoBank · opérations</option>
          </select>
        </label>
        <label>
          Compte destinataire
          <select
            value={accountId}
            disabled={busy}
            onChange={(e) => {
              setAccountId(e.target.value);
              reset();
            }}
          >
            <option value="">Nouveau compte / comptes indiqués dans le CSV</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <small>
            Le compte sélectionné est prioritaire sur les libellés du fichier. Aucun rapprochement
            entre comptes distincts.
          </small>
        </label>
        <label>
          Nom du nouveau compte / compte CSV par défaut
          <input
            value={platform}
            maxLength={120}
            disabled={busy}
            placeholder="Ex. BoursoBank PEA"
            onChange={(e) => {
              setPlatform(e.target.value);
              reset();
            }}
          />
          <small>
            Sans compte sélectionné, le libellé doit correspondre exactement ; PEA et CTO restent
            séparés.
          </small>
        </label>
        <label>
          Devise par défaut
          <select
            value={currency}
            disabled={busy}
            onChange={(e) => {
              setCurrency(e.target.value);
              reset();
            }}
          >
            <option>EUR</option>
            <option>USD</option>
          </select>
        </label>
        <label>
          Fichier CSV ou avis PDF Bourso
          <input
            type="file"
            accept=".csv,.pdf,text/csv,application/pdf"
            disabled={busy}
            onChange={async (e) => {
              reset();
              setCsv('');
              setPdfBase64('');
              const file = e.target.files?.[0];
              if (!file) return;
              const isPdf = file.name.toLowerCase().endsWith('.pdf');
              if (file.size > (isPdf ? 150_000 : 200_000)) {
                setError(isPdf ? 'PDF limité à 150 Ko.' : 'CSV limité à 200 Ko.');
                return;
              }
              try {
                if (isPdf) {
                  const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(',')[1]);
                    reader.onerror = () => reject(new Error('Lecture du PDF impossible.'));
                    reader.readAsDataURL(file);
                  });
                  setPdfBase64(base64);
                  setSource('BOURSORAMA');
                } else setCsv(await file.text());
              } catch {
                setError('Impossible de lire ce fichier.');
              }
            }}
          />
          <small>
            Un avis PDF textuel Euronext Paris (150 Ko) ou un CSV UTF-8 (200 Ko, 500 lignes).
          </small>
        </label>
      </div>
      <button
        className="btn"
        disabled={(!csv && !pdfBase64) || busy || (!!pdfBase64 && !accountId && !platform.trim())}
        onClick={() =>
          run(async () => {
            reset();
            setPreview(
              (await save('imports/preview', 'POST', {
                ...(pdfBase64 ? { pdfBase64 } : { csv }),
                source,
                ...(accountId ? { accountId } : {}),
                listings: Object.entries(listings)
                  .filter(([, ticker]) => ticker)
                  .map(([isin, ticker]) => ({ isin, ticker })),
                ...(platform.trim() ? { platform: platform.trim() } : {}),
                currency,
              })) as ImportPreview,
            );
          })
        }
      >
        <Upload size={16} />
        {busy ? 'Traitement en cours…' : 'Vérifier et afficher l’aperçu'}
      </button>
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
          <ImportSummary preview={preview} />
          {preview.errors.length > 0 && (
            <ul className="error-note" role="alert">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  {e.line ? `Ligne ${e.line} : ` : ''}
                  {e.message}
                  {e.isin && e.symbols && (
                    <label>
                      Cotation pour {e.isin}
                      <select
                        value={listings[e.isin] || ''}
                        disabled={busy}
                        onChange={(event) =>
                          setListings({ ...listings, [e.isin!]: event.target.value })
                        }
                      >
                        <option value="">Choisir une cotation puis relancer l’aperçu</option>
                        {e.symbols.map((symbol) => (
                          <option key={symbol} value={symbol}>
                            {symbol}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
          {preview.summary.EXISTING > 0 && (
            <details>
              <summary>
                {preview.summary.EXISTING} transactions connues · aucune modification
              </summary>
              <ul>
                {preview.rows
                  .filter((r) => r.status === 'EXISTING')
                  .map((r) => (
                    <li key={r.line}>
                      Ligne {r.line} · {r.occurredAt.slice(0, 10)} · {r.asset} ·{' '}
                      {typeLabels[r.type]} · {r.quantity}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {preview.rows.some((r) => r.status !== 'EXISTING') && (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Nouvelles transactions et lignes à vérifier"
            >
              <table>
                <thead>
                  <tr>
                    <th>Ligne / date</th>
                    <th>Actif</th>
                    <th>Opération</th>
                    <th>Quantité</th>
                    <th aria-sort="descending">Montant brut</th>
                    <th>Import</th>
                  </tr>
                </thead>
                <tbody>
                  {sortByValue(
                    preview.rows.filter((r) => r.status !== 'EXISTING'),
                    (r) => valueInEur(r.amount, r.currency, eurUsd),
                  ).map((r) => (
                    <tr key={r.line}>
                      <td>
                        {r.line}
                        <small>{r.occurredAt.slice(0, 10)}</small>
                      </td>
                      <td>{r.asset}</td>
                      <td>
                        {typeLabels[r.type]}
                        <small>
                          Prix : {r.data.unitPrice} {r.currency} · Frais : {r.data.fees}{' '}
                          {r.currency}
                        </small>
                      </td>
                      <td>{r.quantity}</td>
                      <td>
                        {r.amount} {r.currency}
                      </td>
                      <td>
                        <strong>{labels[r.status]}</strong>
                        {r.reason && <p>{r.reason}</p>}
                        {r.candidates.length > 0 && (
                          <details>
                            <summary>
                              Voir les différences ({r.candidates.length} correspondance(s))
                            </summary>
                            {r.candidates.map((candidate) => (
                              <div key={candidate.id}>
                                <a className="text-link" href={`/transactions/${candidate.id}`}>
                                  Voir la transaction existante
                                </a>
                                <ul>
                                  {candidate.differences.map((diff) => (
                                    <li key={diff.field}>
                                      {fieldLabels[diff.field] || diff.field} : {diff.before || '—'}{' '}
                                      → {diff.after || '—'}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </details>
                        )}
                        {['CHANGED', 'AMBIGUOUS'].includes(r.status) && (
                          <>
                            <p className="small">
                              La transaction existante reste intacte. Corrigez-la si nécessaire dans
                              le journal, puis relancez l’analyse.
                            </p>
                            <select
                              aria-label={`Décision ligne ${r.line}`}
                              value={decisions[r.line] || 'IGNORE'}
                              disabled={busy}
                              onChange={(e) =>
                                setDecisions({
                                  ...decisions,
                                  [r.line]: e.target.value as 'IGNORE' | 'CREATE',
                                })
                              }
                            >
                              <option value="IGNORE">Laisser cette ligne de côté</option>
                              {r.canCreate && (
                                <option value="CREATE">
                                  Je confirme : opération distincte à ajouter
                                </option>
                              )}
                            </select>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted">
            Aucune transaction ajoutée avant confirmation. Aperçu valable 30 minutes ; le journal
            est revérifié à la confirmation. Les lignes laissées de côté ne sont ni ajoutées ni
            modifiées.
          </p>
          {preview.summary.NEW === 0 &&
          preview.summary.CHANGED === 0 &&
          preview.summary.AMBIGUOUS === 0 &&
          !preview.errors.length ? (
            <p className="notice">Tout est déjà synchronisé. Aucun changement en base.</p>
          ) : (
            <button
              className="btn primary"
              disabled={busy || !!preview.errors.length || count === 0}
              onClick={() =>
                run(async () => {
                  const result = (await save(`imports/${preview.id}/confirm`, 'POST', {
                    confirmed: true,
                    decisions: Object.entries(decisions)
                      .filter(([, action]) => action === 'CREATE')
                      .map(([line, action]) => ({ line: Number(line), action })),
                  })) as { count: number; skipped: number };
                  setMessage(
                    `Import terminé : ${result.count} transaction(s) ajoutée(s), ${result.skipped} ligne(s) ignorée(s). Les positions sont recalculées depuis le journal.`,
                  );
                  setPreview(null);
                  setCsv('');
                  setPdfBase64('');
                })
              }
            >
              Importer les nouvelles transactions ({count})
            </button>
          )}
        </>
      )}
    </section>
  );
}
