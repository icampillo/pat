'use client';
import { assetCreationSchema, assetUpdateSchema } from '@/shared/schemas';
import type { AppState, AssetView } from '@/shared/types';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Field, type SaveAction } from './shared';
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
