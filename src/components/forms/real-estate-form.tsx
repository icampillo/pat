'use client';
import { useState } from 'react';
import Link from 'next/link';
import { assetCreationSchema, assetUpdateSchema } from '@/shared/schemas';
import { propertyTypes, propertyUsages } from '@/shared/real-estate';
import { monthlyPayment } from '@/domain/mortgage';
import type { AppState, AssetView } from '@/shared/types';
import { Field, type SaveAction } from './shared';

export function RealEstateForm({
  state,
  asset,
  categoryId,
  onCategory,
  save,
  done,
}: {
  state: AppState;
  asset?: AssetView;
  categoryId: string;
  onCategory: (id: string) => void;
  save: SaveAction;
  done: (id: string) => void;
}) {
  const property = asset?.metadata.realEstate;
  const [usage, setUsage] = useState(property?.usage ?? 'PRIMARY_RESIDENCE');
  const [financed, setFinanced] = useState(!!property?.mortgage);
  const [payment, setPayment] = useState(() =>
    property?.mortgage
      ? monthlyPayment(
          property.mortgage.borrowedAmount,
          property.mortgage.annualInterestRate,
          property.mortgage.durationMonths,
        )
      : '',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = state.asOf.slice(0, 10);
  const fields = (
    group: 'property' | 'mortgage' | 'rental',
    definitions: [string, string, boolean?][],
  ) =>
    definitions.map(([key, label, optional]) => {
      const values =
        group === 'property'
          ? property
          : group === 'mortgage'
            ? property?.mortgage
            : property?.rental;
      const value =
        values && key in values ? String(values[key as keyof typeof values] ?? '') : undefined;
      return (
        <Field
          key={key}
          name={`${group}.${key}`}
          type="number"
          label={label}
          value={value ?? (optional ? '0' : '')}
          required={!optional}
        />
      );
    });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const group = (prefix: string) =>
      Object.fromEntries(
        [...fd]
          .filter(
            ([key, value]) =>
              key.startsWith(`${prefix}.`) &&
              (String(value).trim() !== '' ||
                ![
                  'initialRenovations',
                  'monthlyInsurance',
                  'originationFees',
                  'annualOwnerInsurance',
                  'annualManagementFees',
                  'annualOtherExpenses',
                ].includes(key.slice(prefix.length + 1))),
          )
          .map(([key, value]) => [key.slice(prefix.length + 1), String(value).trim()]),
      );
    const raw = group('property');
    const mortgage = group('mortgage');
    const value = {
      name: fd.get('name'),
      symbol: asset?.symbol ?? String(fd.get('name')).slice(0, 100),
      categoryId,
      currency: asset?.currency ?? 'EUR',
      platform: asset?.platform ?? 'Personnel',
      notes: fd.get('notes'),
      status: asset?.status ?? 'ACTIVE',
      subcategory: '',
      externalId: '',
      metadata: {
        realEstate: {
          ...raw,
          schemaVersion: 1,
          usage,
          currentValue: raw.currentValue || null,
          valuationDate: raw.currentValue ? raw.valuationDate || null : null,
          mortgage: financed
            ? { ...mortgage, durationMonths: Number(mortgage.durationMonths) }
            : null,
          ...(usage === 'RENTAL' ? { rental: group('rental') } : {}),
        },
      },
    };
    const parsed = (asset ? assetUpdateSchema : assetCreationSchema).safeParse(value);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.slice(2).join(' › ')} : ${issue.message}`)
          .join(' '),
      );
      return;
    }
    setBusy(true);
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
      <form
        className="panel form-panel"
        onSubmit={submit}
        onChange={(e) => {
          const fd = new FormData(e.currentTarget);
          try {
            setPayment(
              monthlyPayment(
                String(fd.get('mortgage.borrowedAmount')),
                String(fd.get('mortgage.annualInterestRate')),
                Number(fd.get('mortgage.durationMonths')),
              ),
            );
          } catch {
            setPayment('');
          }
        }}
      >
        <h2>{asset ? 'Modifier le bien immobilier' : 'Ajouter un bien immobilier'}</h2>
        <h3>1. Bien</h3>
        <div className="form-grid">
          <Field name="name" label="Nom du bien" value={asset?.name} required />
          <label>
            Catégorie
            <select
              aria-label="Catégorie"
              value={categoryId}
              disabled={!!asset}
              onChange={(e) => onCategory(e.target.value)}
            >
              {state.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type de bien
            <select
              aria-label="Type de bien"
              name="property.propertyType"
              defaultValue={property?.propertyType ?? 'APARTMENT'}
            >
              {Object.entries(propertyTypes).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Usage
            <select
              aria-label="Usage"
              value={usage}
              onChange={(e) => setUsage(e.target.value as typeof usage)}
            >
              {Object.entries(propertyUsages).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Field name="property.city" label="Ville" value={property?.city} required />
          <Field name="property.country" label="Pays" value={property?.country ?? 'FR'} required />
          <Field name="property.address" label="Adresse (facultative)" value={property?.address} />
          <Field
            name="property.ownershipPercent"
            label="Détention (%)"
            value={property?.ownershipPercent ?? '100'}
            required
          />
          <Field
            name="property.currentValue"
            label={`Valeur actuelle du bien entier (${asset?.currency ?? 'EUR'})`}
            value={property?.currentValue ?? ''}
            help="Laissez vide si inconnue. Zéro signifie une valeur nulle connue."
          />
          <Field
            name="property.valuationDate"
            label="Date de dernière estimation"
            type="date"
            value={property?.valuationDate ?? today}
          />
        </div>
        <h3>2. Acquisition</h3>
        <p className="small muted">
          Montants pour le bien entier, dans la devise de la fiche ({asset?.currency ?? 'EUR'}).
        </p>
        <div className="form-grid">
          <Field
            name="property.purchaseDate"
            label="Date d’acquisition"
            type="date"
            value={property?.purchaseDate ?? today}
            required
          />
          {fields('property', [
            ['purchasePrice', 'Prix d’acquisition'],
            ['acquisitionFees', 'Frais d’acquisition / notaire'],
            ['initialRenovations', 'Travaux initiaux', true],
          ])}
        </div>
        <h3>3. Financement</h3>
        <label>
          Crédit immobilier
          <select
            aria-label="Crédit immobilier"
            value={financed ? 'yes' : 'no'}
            onChange={(e) => setFinanced(e.target.value === 'yes')}
          >
            <option value="no">Sans crédit</option>
            <option value="yes">Prêt amortissable à taux fixe</option>
          </select>
        </label>
        {financed && (
          <>
            <p className="small muted">
              Saisissez uniquement votre dette et votre apport : aucune seconde réduction par le
              pourcentage de détention. Première échéance un mois après le début du prêt.
            </p>
            <div className="form-grid">
              {fields('mortgage', [
                ['borrowedAmount', 'Montant emprunté attribué'],
                ['downPayment', 'Apport personnel'],
                ['annualInterestRate', 'Taux nominal annuel (%)'],
                ['durationMonths', 'Durée (mois)'],
                ['monthlyInsurance', 'Assurance emprunteur mensuelle', true],
                ['originationFees', 'Frais de dossier / garantie', true],
              ])}
              <Field
                name="mortgage.startDate"
                label="Date de début du prêt"
                type="date"
                value={property?.mortgage?.startDate ?? property?.purchaseDate ?? today}
                required
              />
              <label>
                Mensualité hors assurance calculée
                <output style={{ display: 'block' }}>
                  {payment || '—'} {asset?.currency ?? 'EUR'}
                </output>
                <small>
                  Calculée depuis le montant, le taux et la durée. Dernière échéance ajustée au
                  centime.
                </small>
              </label>
            </div>
          </>
        )}
        {usage === 'RENTAL' && (
          <>
            <h3>4. Location</h3>
            <p className="small muted">
              Montants du bien entier. Charges facultatives omises : hypothèse de zéro. Estimations
              avant fiscalité, sans vacance locative.
            </p>
            <div className="form-grid">
              {fields('rental', [
                ['monthlyRent', 'Loyer mensuel hors charges'],
                ['monthlyNonRecoverableCharges', 'Charges mensuelles non récupérables'],
                ['annualPropertyTax', 'Taxe foncière annuelle'],
                ['annualOwnerInsurance', 'Assurance propriétaire annuelle', true],
                ['annualManagementFees', 'Frais de gestion annuels', true],
                ['annualOtherExpenses', 'Autres dépenses annuelles', true],
              ])}
            </div>
          </>
        )}
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
            {busy ? 'Enregistrement…' : 'Enregistrer le bien'}
          </button>
        </div>
      </form>
    </div>
  );
}
