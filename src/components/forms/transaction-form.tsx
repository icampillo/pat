'use client';
import { decimal } from '@/domain/money';
import { transactionSchema, typeLabels } from '@/shared/schemas';
import type { AppState, TransactionView } from '@/shared/types';
import { ArrowLeft, Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Field, nowLocal, type SaveAction } from './shared';
export function TransactionForm({
  state,
  save,
  done,
  initialAsset,
  transaction,
}: {
  state: AppState;
  save: SaveAction;
  done: () => void;
  initialAsset?: string;
  transaction?: TransactionView;
}) {
  const [initialOccurredAt] = useState(() => nowLocal(transaction?.occurredAt));
  const [type, setType] = useState(transaction?.type || 'BUY'),
    [assetId, setAssetId] = useState(
      transaction
        ? transaction.assetId || ''
        : initialAsset || state.rows.find((a) => !a.deletedAt && a.status === 'ACTIVE')?.id || '',
    );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [quantity, setQuantity] = useState(transaction?.quantity || ''),
    [price, setPrice] = useState(transaction?.unitPrice || '');
  const asset = state.rows.find((a) => a.id === assetId);
  const hasAmount = !assetId || ['DIVIDEND', 'DEPOSIT', 'WITHDRAWAL'].includes(type);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const data = {
      type,
      assetId: assetId || null,
      quantity: fd.get('quantity') || '0',
      unitPrice: fd.get('unitPrice') || '0',
      fees: fd.get('fees') || '0',
      amount: fd.get('amount') || '0',
      currency: fd.get('currency'),
      platform: fd.get('platform'),
      destination: fd.get('destination') || null,
      settlement: fd.get('settlement') || 'EXTERNAL',
      occurredAt:
        transaction && String(fd.get('occurredAt')) === nowLocal(transaction.occurredAt)
          ? transaction.occurredAt
          : !transaction && String(fd.get('occurredAt')) === initialOccurredAt
            ? new Date().toISOString()
            : new Date(String(fd.get('occurredAt'))).toISOString(),
      comment: fd.get('comment') || '',
      externalReference: fd.get('externalReference') || null,
    };
    const parsed = transactionSchema.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(' '));
      setBusy(false);
      return;
    }
    try {
      await save(
        transaction ? `transactions/${transaction.id}` : 'transactions',
        transaction ? 'PATCH' : 'POST',
        transaction ? { transaction: parsed.data, reason: fd.get('reason') } : parsed.data,
        transaction?.version,
      );
      done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  let preview = '—';
  try {
    preview = decimal(quantity || '0')
      .mul(price || '0')
      .toFixed(2);
  } catch {
    /* saisie en cours */
  }
  const archived = state.rows.find(
    (row) => row.id === (transaction?.assetId || initialAsset) && row.status === 'ARCHIVED',
  );
  if (archived)
    return (
      <div className="panel form-panel">
        <p>Cet actif est archivé. Réactivez-le avant d’ajouter ou corriger une opération.</p>
        <Link className="btn" href={`/assets/${archived.id}`}>
          Consulter l’actif archivé
        </Link>
      </div>
    );
  return (
    <div className="form-wrap">
      <Link className="back" href="/transactions">
        <ArrowLeft size={16} /> Toutes les transactions
      </Link>
      <form className="panel form-panel" onSubmit={submit}>
        <div className="section-title">
          <div>
            <h2>{transaction ? 'Corriger une opération' : 'Enregistrer une opération'}</h2>
            <p>Vos quantités et votre prix moyen seront recalculés.</p>
          </div>
          <span className="step-tag">JOURNAL</span>
        </div>
        <div className="form-grid">
          <label>
            Type d’opération
            <select
              aria-label="Type d’opération"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {Object.entries(typeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Actif concerné
            <select
              aria-label="Actif concerné"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
            >
              <option value="">Liquidités</option>
              {state.rows
                .filter((a) => !a.deletedAt && a.status === 'ACTIVE')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.symbol}
                  </option>
                ))}
            </select>
          </label>
          {assetId && type !== 'DIVIDEND' && (
            <>
              <label>
                Quantité
                <input
                  name="quantity"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </label>
              <label>
                {type === 'DEPOSIT' ? 'Coût unitaire d’origine' : 'Prix unitaire'}
                <input
                  name="unitPrice"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          {hasAmount && (
            <Field
              name="amount"
              value={transaction?.amount}
              label={
                assetId && ['DEPOSIT', 'WITHDRAWAL'].includes(type)
                  ? 'Valeur totale au moment du transfert'
                  : 'Montant'
              }
              required
            />
          )}
          <label>
            Devise
            <select
              name="currency"
              key={assetId}
              defaultValue={transaction?.currency || asset?.currency || 'EUR'}
            >
              <option>EUR</option>
              <option>USD</option>
            </select>
          </label>
          <Field
            name="occurredAt"
            label="Date de l’opération"
            type="datetime-local"
            value={initialOccurredAt}
            required
          />
          {['BUY', 'SELL'].includes(type) && (
            <>
              <Field name="fees" label="Frais" value={transaction?.fees || '0'} />
              <label>
                {type === 'BUY' ? 'Financement' : 'Destination du produit'}
                <select
                  name="settlement"
                  key={type}
                  defaultValue={
                    transaction?.settlement || (type === 'SELL' ? 'INTERNAL' : 'EXTERNAL')
                  }
                >
                  <option value="EXTERNAL">Extérieur au portefeuille</option>
                  <option value="INTERNAL">Liquidités du portefeuille</option>
                </select>
              </label>
            </>
          )}
          <Field
            key={`${assetId}-platform`}
            name="platform"
            label="Plateforme / conservation"
            value={transaction?.platform || asset?.platform || 'Personnel'}
            required
          />
          {type === 'TRANSFER' && (
            <Field
              name="destination"
              value={transaction?.destination || ''}
              label="Plateforme de destination"
              required
            />
          )}
          <Field
            name="externalReference"
            value={transaction?.externalReference || ''}
            label="Référence externe (facultative)"
          />
        </div>
        {['BUY', 'SELL'].includes(type) && (
          <div className="form-preview">
            <span>Montant hors frais</span>
            <strong>{preview}</strong>
          </div>
        )}
        <label>
          {type === 'ADJUSTMENT' ? 'Motif de l’ajustement initial (obligatoire)' : 'Commentaire'}
          <textarea
            name="comment"
            defaultValue={transaction?.comment}
            rows={3}
            required={type === 'ADJUSTMENT'}
          />
        </label>
        {transaction && <Field name="reason" label="Motif de correction" required />}
        {error && (
          <p role="alert" className="error-note">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Link className="btn" href="/transactions">
            Annuler
          </Link>
          <button className="btn primary" disabled={busy}>
            <Check size={16} />
            {busy ? 'Enregistrement…' : 'Enregistrer la transaction'}
          </button>
        </div>
      </form>
    </div>
  );
}
