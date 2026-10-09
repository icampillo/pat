'use client';
import { useState } from 'react';
import { parisDateTime } from '@/domain/inventory-date';
import { errorMessage } from '@/shared/errors';
import type { TransactionView } from '@/shared/types';
import type { SaveAction } from './shared';

type Correction = {
  version: number;
  before: string;
  asOf: string;
  importedAt: string;
  quantity: string;
  unitPrice: string;
  currency: string;
};
const display = (value: string) =>
  new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
export function InventoryDateForm({
  transaction,
  save,
  done,
}: {
  transaction: TransactionView;
  save: SaveAction;
  done: () => void;
}) {
  const [local, setLocal] = useState(() =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(transaction.occurredAt))
      .replace(' ', 'T'),
  );
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Correction | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(confirm: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await save(`securities/inventories/${transaction.id}/date`, 'POST', {
        asOf: parisDateTime(local),
        reason,
        ...(confirm && preview ? { confirmed: true, version: preview.version } : {}),
      });
      if (confirm) done();
      else setPreview(result as Correction);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel">
      <h2>Corriger la date effective de l’inventaire</h2>
      <p>
        {transaction.assetName} · {transaction.platform} · {transaction.quantity} parts. Cet
        inventaire n’est pas un achat ou une vente.
      </p>
      <p>
        Les quantités, coûts, taux de change et snapshots enregistrés restent conservés. Une
        révision du journal trace la correction.
      </p>
      <label>
        Date effective (Europe/Paris)
        <input
          type="datetime-local"
          step="1"
          value={local}
          disabled={busy}
          onChange={(e) => {
            setLocal(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <label>
        Motif et source de la date
        <input
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(e) => {
            setReason(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <button
        className="btn"
        disabled={busy || !local || reason.trim().length < 3}
        onClick={() => run(false)}
      >
        Vérifier la correction
      </button>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="notice">
          <p>
            Date effective : {display(preview.before)} → {display(preview.asOf)} (Europe/Paris).
          </p>
          <p>
            Import réel conservé : {display(preview.importedAt)}. Quantité : {preview.quantity},
            coût unitaire : {preview.unitPrice} {preview.currency}.
          </p>
          <p>
            Les snapshots passés restent des observations historiques ; ils ne seront pas
            recalculés. Après correction, relancez l’aperçu des avis d’opéré.
          </p>
          <button className="btn primary" disabled={busy} onClick={() => run(true)}>
            Confirmer uniquement la correction de date
          </button>
        </div>
      )}
    </section>
  );
}
