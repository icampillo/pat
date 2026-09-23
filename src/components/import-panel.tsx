'use client';
import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { ImportPreview } from '@/server/imports';
import type { SaveAction } from './forms';
import { typeLabels } from '@/shared/schemas';
export function ImportPanel({ save }: { save: SaveAction }) {
  const [csv, setCsv] = useState(''),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return (
    <section className="panel detail-panel import-panel">
      <h2>Importer des transactions</h2>
      <p className="muted">
        CSV UTF-8, 500 lignes maximum. Créez les actifs avant l’import. Chaque ligne doit avoir une
        référence externe unique.
      </p>
      <a className="text-link" href="/import-transactions.csv" download>
        Télécharger le modèle CSV
      </a>
      <label>
        Fichier CSV
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            setError('');
            setPreview(null);
            setDone(false);
            setCsv('');
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 200_000) {
              setError('Fichier limité à 200 Ko.');
              return;
            }
            setCsv(await file.text());
          }}
        />
      </label>
      <button
        className="btn"
        disabled={!csv || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setPreview((await save('imports/preview', 'POST', { csv })) as ImportPreview);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Upload size={16} />
        Vérifier et afficher l’aperçu
      </button>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="notice" role="status">
          Import terminé. Les transactions sont dans votre journal.
        </p>
      )}
      {preview && !done && (
        <>
          <h3>Aperçu · {preview.rows.length} lignes valides</h3>
          {preview.errors.length > 0 && (
            <ul className="error-note" role="alert">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  {e.line ? `Ligne ${e.line} : ` : ''}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Actif</th>
                  <th>Opération</th>
                  <th>Quantité</th>
                  <th>Montant brut</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.asset}</td>
                    <td>{typeLabels[r.type]}</td>
                    <td>{r.quantity}</td>
                    <td>
                      {r.amount} {r.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Aucune écriture n’est créée avant confirmation. Aperçu valable 30 minutes et tant que le
            portefeuille reste inchangé.
          </p>
          <button
            className="btn primary"
            disabled={busy || preview.errors.length > 0}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await save(`imports/${preview.id}/confirm`, 'POST', { confirmed: true });
                setDone(true);
                setPreview(null);
                setCsv('');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirmer l’import de {preview.rows.length} transactions
          </button>
        </>
      )}
    </section>
  );
}
