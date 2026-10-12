'use client';
import { BusyLabel } from '@/components/ui/busy-label';
import { ArrowLeft } from 'lucide-react';
import { money } from '@/components/workspace/display';
import { categoryStyle } from '@/components/ui/category-appearance';
import { errorMessage } from '@/shared/errors';
import { useState } from 'react';
import Link from '@/components/workspace/link';
import { assetCreationSchema, assetUpdateSchema } from '@/shared/schemas';
import {
  propertyTypes,
  propertyUsages,
  propertyMortgages,
  type Mortgage,
} from '@/shared/real-estate';
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
  const [loans, setLoans] = useState(() => {
    const existing = property ? propertyMortgages(property) : [];
    return existing.map((loan, id) => ({ id, loan: loan as Mortgage | undefined }));
  });
  const [nextLoanId, setNextLoanId] = useState(loans.length);
  const [estimateWarning, setEstimateWarning] = useState(
    property?.currentValue != null && Number(property.currentValue) === 0,
  );
  const addLoan = () => {
    setLoans([...loans, { id: nextLoanId, loan: undefined }]);
    setNextLoanId(nextLoanId + 1);
  };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = state.asOf.slice(0, 10);
  const fields = (group: 'property' | 'rental', definitions: [string, string, boolean?][]) =>
    definitions.map(([key, label, optional]) => {
      const values = group === 'property' ? property : property?.rental;
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
    const mortgages = loans.map(({ id, loan }) => {
      const rawLoan = group(`loan${id}`);
      const { remainingPrincipal, balanceDate, ...parameters } = rawLoan;
      const observations = [...(loan?.balanceObservations ?? [])];
      if (remainingPrincipal) {
        if (observations.at(-1)?.date === balanceDate) observations.pop();
        observations.push({ date: balanceDate, remainingPrincipal });
      }
      return {
        ...parameters,
        durationMonths: Number(parameters.durationMonths),
        ...(observations.length ? { balanceObservations: observations } : {}),
      };
    });
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
          mortgage: mortgages[0] ?? null,
          additionalMortgages: mortgages.slice(1),
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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-wrap" style={categoryStyle('REAL_ESTATE')}>
      <Link className="back" href="/categories/real-estate">
        <ArrowLeft size={16} aria-hidden="true" />
        Immobilier
      </Link>
      <form
        className="panel form-panel"
        onSubmit={submit}
        onChange={(e) => {
          const fd = new FormData(e.currentTarget);
          const estimate = String(fd.get('property.currentValue')).trim();
          setEstimateWarning(estimate !== '' && Number(estimate) === 0);
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
        {estimateWarning && (
          <p className="notice" role="status">
            Une valeur du bien à zéro produit un patrimoine net égal à l’opposé de la dette.
            Renseignez l’estimation du bien, pas le capital remboursé. Laissez vide si elle est
            inconnue.
          </p>
        )}
        <p className="small muted">
          Patrimoine immobilier net = valeur actuelle × détention − capital restant dû. L’apport et
          le capital remboursé ne sont pas ajoutés une seconde fois.
        </p>
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
            value={loans.length ? 'yes' : 'no'}
            onChange={(e) => (e.target.value === 'yes' ? addLoan() : setLoans([]))}
          >
            <option value="no">Sans crédit</option>
            <option value="yes">Prêt amortissable à taux fixe</option>
          </select>
        </label>
        <p className="small muted">
          Saisissez uniquement votre dette : aucune seconde réduction par le pourcentage de
          détention. Sans relevé manuel, les échéances sont supposées payées. Avec un relevé, le
          solde reste celui déclaré jusqu’à votre prochaine mise à jour, remboursements anticipés
          compris.
        </p>
        {loans.map(({ id, loan }, index) => (
          <MortgageFields
            key={id}
            prefix={`loan${id}`}
            loan={loan}
            index={index}
            today={today}
            currency={asset?.currency ?? 'EUR'}
            remove={() => setLoans(loans.filter((item) => item.id !== id))}
          />
        ))}
        <button type="button" className="btn" disabled={loans.length >= 20} onClick={addLoan}>
          Ajouter un crédit
        </button>
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
          <button aria-busy={busy} className="btn primary" disabled={busy}>
            <BusyLabel busy={busy} pending="Enregistrement…">
              Enregistrer le bien
            </BusyLabel>
          </button>
        </div>
      </form>
    </div>
  );
}

function MortgageFields({
  prefix,
  loan,
  index,
  today,
  currency,
  remove,
}: {
  prefix: string;
  loan?: Mortgage;
  index: number;
  today: string;
  currency: string;
  remove: () => void;
}) {
  const [payment, setPayment] = useState(() =>
    loan ? monthlyPayment(loan.borrowedAmount, loan.annualInterestRate, loan.durationMonths) : '',
  );
  const observation = loan?.balanceObservations?.at(-1);
  return (
    <fieldset
      className="panel detail-panel"
      style={{ minWidth: 0 }}
      onChange={(event) => {
        const fd = new FormData(event.currentTarget.closest('form')!);
        try {
          setPayment(
            monthlyPayment(
              String(fd.get(`${prefix}.borrowedAmount`)),
              String(fd.get(`${prefix}.annualInterestRate`)),
              Number(fd.get(`${prefix}.durationMonths`)),
            ),
          );
        } catch {
          setPayment('');
        }
      }}
    >
      <legend>Crédit {index + 1}</legend>
      <div className="form-grid">
        {(
          [
            ['borrowedAmount', 'Montant emprunté attribué', false],
            ['downPayment', 'Apport personnel', false],
            ['annualInterestRate', 'Taux nominal annuel (%)', false],
            ['durationMonths', 'Durée (mois)', false],
            ['monthlyInsurance', 'Assurance emprunteur mensuelle', true],
            ['originationFees', 'Frais de dossier / garantie', true],
          ] as const
        ).map(([key, label, optional]) => (
          <Field
            key={key}
            name={`${prefix}.${key}`}
            label={label}
            type="number"
            value={String(loan?.[key] ?? (optional ? '0' : ''))}
            required={!optional}
          />
        ))}
        <Field
          name={`${prefix}.startDate`}
          label="Date de début du prêt"
          type="date"
          value={loan?.startDate ?? today}
          required
        />
        <label>
          Mensualité hors assurance calculée
          <output style={{ display: 'block' }}>{money(payment || null, currency)}</output>
          <small>Échéancier théorique initial, dernière échéance ajustée au centime.</small>
        </label>
        <Field
          name={`${prefix}.remainingPrincipal`}
          label="Capital restant dû actuel"
          type="number"
          help={
            observation
              ? `Dernier relevé : ${money(observation.remainingPrincipal, currency)} au ${observation.date}. Laissez vide pour le conserver.`
              : 'Facultatif : solde du relevé bancaire, hors intérêts et assurance. Zéro signifie prêt soldé.'
          }
        />
        <Field
          name={`${prefix}.balanceDate`}
          label="Date du relevé de capital"
          type="date"
          value={today}
          required
        />
      </div>
      <button type="button" className="btn" onClick={remove}>
        Retirer le crédit {index + 1}
      </button>
    </fieldset>
  );
}
