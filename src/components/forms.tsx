'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Save } from 'lucide-react';
import {
  assetCreationSchema,
  assetUpdateSchema,
  transactionSchema,
  typeLabels,
} from '@/shared/schemas';
import type { AppState, AssetView, TransactionView } from '@/shared/types';
import { decimal } from '@/domain/money';
export type SaveAction = (
  path: string,
  method: string,
  data: unknown,
  version?: number,
) => Promise<{ id?: string }>;
const nowLocal = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function Field({
  label,
  name,
  value = '',
  type = 'text',
  required = false,
  help,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        defaultValue={value}
        type={type}
        inputMode={
          ['quantity', 'acquisitionCost', 'meta.weightGrams', 'meta.purity'].includes(name)
            ? 'decimal'
            : undefined
        }
        required={required}
        step={type === 'number' ? 'any' : undefined}
      />
      {help && <small>{help}</small>}
    </label>
  );
}
export function AssetForm({
  state,
  asset,
  save,
  done,
}: {
  state: AppState;
  asset?: AssetView;
  save: SaveAction;
  done: (id: string) => void;
}) {
  const [category, setCategory] = useState(asset?.categoryId || state.categories[0]?.id || '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const kind = state.categories.find((c) => c.id === category)?.key;
  const meta = asset?.metadata || {};
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const metadata: Record<string, string> = { ...meta };
    for (const [key, value] of fd.entries())
      if (key.startsWith('meta.') && String(value).trim())
        metadata[key.slice(5)] = String(value).trim();
    const value = {
      name: fd.get('name'),
      symbol:
        asset?.symbol ||
        String(fd.get('name') || '')
          .trim()
          .slice(0, 100),
      categoryId: category,
      currency: asset?.currency || 'EUR',
      platform: asset?.platform || 'Personnel',
      notes: fd.get('notes'),
      subcategory: asset?.subcategory || '',
      externalId: asset?.externalId || '',
      status: asset?.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
      metadata,
      acquisitionCost: String(fd.get('acquisitionCost') || '').trim() || undefined,
      ...(!asset ? { quantity: String(fd.get('quantity') || '').trim() || undefined } : {}),
    };
    const parsed = asset
      ? assetUpdateSchema.safeParse(value)
      : assetCreationSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(' '));
      setBusy(false);
      return;
    }
    try {
      const result = await save(
        asset ? `assets/${asset.id}` : 'assets',
        asset ? 'PATCH' : 'POST',
        parsed.data,
        asset?.version,
      );
      done(result.id!);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-wrap">
      <Link className="back" href="/assets">
        <ArrowLeft size={16} /> Tous les actifs
      </Link>
      <form className="panel form-panel" onSubmit={submit}>
        <div className="section-title">
          <div>
            <h2>{asset ? 'Modifier la fiche' : 'Un nouvel actif à suivre'}</h2>
            <p>Indiquez ce que vous détenez. La valeur des métaux se calcule automatiquement.</p>
          </div>
          <span className="step-tag">FICHE D’ACTIF</span>
        </div>
        <div className="form-grid">
          <Field name="name" label="Nom de l’actif" value={asset?.name} required />
          <label>
            Catégorie
            <select
              aria-label="Catégorie"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {state.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {!asset && (
            <Field
              name="quantity"
              label="Quantité détenue"
              type="number"
              required
              help="Nombre de pièces ou d’unités que vous possédez."
            />
          )}
          <Field
            name="acquisitionCost"
            type="number"
            label={
              asset
                ? `Corriger le coût d’acquisition total (${asset.currency === 'USD' ? '$' : '€'})`
                : 'Coût d’acquisition total (€)'
            }
            help={
              asset
                ? 'Facultatif. Laissez vide pour conserver le coût actuel. Cette correction est disponible si la fiche n’a qu’une opération initiale.'
                : 'Facultatif. Montant payé pour toute la quantité saisie. Laissez vide si vous ne le connaissez pas.'
            }
          />
        </div>
        <h3>Caractéristiques</h3>
        <div className="form-grid">
          {kind === 'CRYPTO' && (
            <>
              <Field name="meta.network" label="Réseau" value={meta.network} />
              <Field
                name="meta.contractAddress"
                label="Adresse du contrat (facultative)"
                value={meta.contractAddress}
              />
              <Field
                name="meta.stakingRate"
                label="Rendement indicatif (%)"
                value={meta.stakingRate}
              />
            </>
          )}
          {kind === 'METALS' && (
            <>
              <label>
                Métal
                <select name="meta.metalType" defaultValue={meta.metalType || 'GOLD'}>
                  <option value="GOLD">Or</option>
                  <option value="SILVER">Argent</option>
                </select>
              </label>
              <Field
                name="meta.weightGrams"
                label="Poids brut par pièce (g)"
                value={meta.weightGrams}
                required
              />
              <Field
                name="meta.purity"
                label="Pureté (de 0 à 1)"
                value={meta.purity}
                required
                help="Exemple : 0.900 pour 900 ‰"
              />
              <Field name="meta.year" label="Année" value={meta.year} />
              <Field name="meta.country" label="Pays" value={meta.country} />
              <Field name="meta.faceValue" label="Valeur faciale" value={meta.faceValue} />
            </>
          )}
          {kind === 'SECURITIES' && (
            <>
              <Field name="meta.ticker" label="Ticker" value={meta.ticker} />
              <Field name="meta.exchange" label="Place de cotation" value={meta.exchange} />
              <Field name="meta.isin" label="ISIN" value={meta.isin} />
              <label>
                Type
                <select name="meta.instrumentType" defaultValue={meta.instrumentType || 'STOCK'}>
                  <option value="STOCK">Action</option>
                  <option value="ETF">ETF</option>
                </select>
              </label>
            </>
          )}
          {['POKEMON', 'ONE_PIECE'].includes(kind || '') && (
            <>
              {[
                ['setName', 'Extension'],
                ['cardNumber', 'Numéro de carte'],
                ['language', 'Langue'],
                ['condition', 'État'],
                ['grade', 'Note de grading'],
                ['gradingCompany', 'Société de grading'],
                ['certificateNumber', 'Certification'],
                ['year', 'Année'],
                ['referenceUrl', 'Lien de référence HTTPS'],
              ].map(([key, label]) => (
                <Field key={key} name={`meta.${key}`} label={label} value={meta[key]} />
              ))}
            </>
          )}
          {kind === 'OTHER' && (
            <p className="muted">Décrivez les caractéristiques utiles dans les notes.</p>
          )}
        </div>
        <label>
          Notes
          <textarea name="notes" defaultValue={asset?.notes} rows={3} maxLength={5000} />
        </label>
        {error && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Link className="btn" href={asset ? `/assets/${asset.id}` : '/assets'}>
            Annuler
          </Link>
          <button className="btn primary" disabled={busy}>
            <Save size={16} />
            {busy ? 'Enregistrement…' : 'Enregistrer l’actif'}
          </button>
        </div>
      </form>
    </div>
  );
}
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
        : initialAsset || state.rows.find((a) => !a.deletedAt)?.id || '',
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
                .filter((a) => !a.deletedAt)
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
