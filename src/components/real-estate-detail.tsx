'use client';
import { useMemo, useState } from 'react';
import { amortization } from '@/domain/mortgage';
import { propertyTypes, propertyUsages } from '@/shared/real-estate';
import type { AssetView } from '@/shared/types';
import { money } from './workspace/display';
import { PriceHistoryList } from './assets/price-history';

export function RealEstateDetail({ asset }: { asset: AssetView }) {
  const property = asset.metadata.realEstate!;
  const value = asset.realEstate!;
  const [page, setPage] = useState(0);
  const rows = useMemo(
    () => (property.mortgage ? amortization(property.mortgage) : []),
    [property.mortgage],
  );
  const amount = (v: string | null) => money(v, asset.currency);
  const metrics = (items: [string, string][]) => (
    <dl className="details-list">
      {items.map(([label, result]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{result}</dd>
        </div>
      ))}
    </dl>
  );
  const loan = property.mortgage;
  const finance = value.mortgage;
  return (
    <>
      <div className="metrics">
        {[
          ['Valeur actuelle du bien entier', asset.price],
          ['Valeur brute détenue', value.ownedValue],
          ['Dette attribuée', value.remainingPrincipal],
          ['Valeur nette', value.equity],
        ].map(([label, result]) => (
          <section className="metric" key={label}>
            <div className="metric-top">{label}</div>
            <strong>{amount(result)}</strong>
          </section>
        ))}
      </div>
      <div className="detail-grid">
        <section className="panel detail-panel">
          <h2>Vue générale</h2>
          {metrics([
            [
              'Type / usage',
              `${propertyTypes[property.propertyType]} · ${propertyUsages[property.usage]}`,
            ],
            ['Localisation', `${property.city}, ${property.country}`],
            ['Adresse', property.address || '—'],
            ['Détention', `${property.ownershipPercent} %`],
            ['Acquisition', property.purchaseDate],
            ['Prix d’acquisition du bien', amount(property.purchasePrice)],
            ['Frais d’acquisition', amount(property.acquisitionFees)],
            ['Travaux initiaux', amount(property.initialRenovations)],
            ['Coût d’acquisition du bien', amount(value.acquisitionCost)],
            ['Prix d’acquisition détenu', amount(value.acquisitionOwnedValue)],
            ['Plus-value brute sur la part détenue', amount(value.grossGain)],
            ['Dernière estimation', asset.priceDate?.slice(0, 10) ?? 'Inconnue'],
          ])}
          <p className="small muted">
            La plus-value brute mesure uniquement la variation du prix du bien. L’equity comprend
            aussi les remboursements de capital ; elle ne mesure pas un rendement.
          </p>
          {asset.notes && <p className="notes">{asset.notes}</p>}
          <PriceHistoryList id={asset.id} currency={asset.currency} />
        </section>
        <section className="panel detail-panel">
          <h2>Financement</h2>
          {loan && finance ? (
            <>
              {metrics([
                ['Montant emprunté attribué', amount(loan.borrowedAmount)],
                ['Apport personnel', amount(loan.downPayment)],
                ['Taux nominal annuel', `${loan.annualInterestRate} %`],
                ['Durée', `${loan.durationMonths} mois`],
                ['Début du prêt', loan.startDate],
                ['Mensualité hors assurance', amount(finance.monthlyPayment)],
                ['Assurance mensuelle', amount(loan.monthlyInsurance)],
                ['Capital remboursé', amount(finance.principalPaid)],
                ['Capital restant dû', amount(finance.remainingPrincipal)],
                ['Intérêts déjà payés', amount(finance.interestPaid)],
                ['Intérêts futurs estimés', amount(finance.interestRemaining)],
                ['Intérêts totaux', amount(finance.totalInterest)],
                ['Assurance déjà payée', amount(finance.insurancePaid)],
                ['Assurance restante', amount(finance.insuranceRemaining)],
                ['Assurance totale estimée', amount(finance.totalInsurance)],
                ['Frais de dossier / garantie', amount(loan.originationFees)],
                ['Coûts déjà supportés (hors capital)', amount(finance.costsPaid)],
                ['Coûts futurs prévisionnels', amount(finance.costsRemaining)],
                ['Coût total prévisionnel du crédit', amount(finance.totalCost)],
                ['Échéances restantes', String(finance.remainingPayments)],
                ['Fin théorique', finance.endDate],
              ])}
              <label>
                Capital remboursé : {finance.progressPercent} %
                <progress max={100} value={Number(finance.progressPercent)} />
              </label>
              <p className="small muted">
                Échéances supposées payées à la date prévue. Prêt à taux fixe, sans remboursement
                anticipé. Les coûts excluent le remboursement du capital.
              </p>
            </>
          ) : (
            <p>Bien financé sans crédit.</p>
          )}
        </section>
      </div>
      {rows.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>Plan d’amortissement</h2>
              <p>12 échéances par page · montants en {asset.currency}</p>
            </div>
            <div className="heading-actions">
              <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Précédent
              </button>
              <span aria-live="polite">
                {page + 1} / {Math.ceil(rows.length / 12)}
              </span>
              <button
                className="btn"
                disabled={(page + 1) * 12 >= rows.length}
                onClick={() => setPage(page + 1)}
              >
                Suivant
              </button>
            </div>
          </div>
          <div
            className="table-scroll"
            role="region"
            aria-label="Plan d’amortissement"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  {[
                    'Échéance',
                    'Date',
                    'Mensualité',
                    'Intérêts',
                    'Capital',
                    'Assurance',
                    'Paiement total',
                    'Capital restant',
                  ].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 12, (page + 1) * 12).map((row) => (
                  <tr key={row.number}>
                    <td>{row.number}</td>
                    <td>{row.date}</td>
                    {[
                      row.payment,
                      row.interest,
                      row.principal,
                      row.insurance,
                      row.totalPayment,
                      row.remainingPrincipal,
                    ].map((v, i) => (
                      <td className="num" key={i}>
                        {amount(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {property.usage === 'RENTAL' && value.rental && property.rental && (
        <section className="panel detail-panel">
          <h2>Location · estimation avant fiscalité</h2>
          {metrics([
            ['Loyer mensuel du bien', amount(property.rental.monthlyRent)],
            ['Loyer annuel du bien', amount(value.rental.annualRent)],
            [
              'Charges mensuelles non récupérables',
              amount(property.rental.monthlyNonRecoverableCharges),
            ],
            ['Taxe foncière annuelle', amount(property.rental.annualPropertyTax)],
            ['Assurance propriétaire annuelle', amount(property.rental.annualOwnerInsurance)],
            ['Gestion annuelle', amount(property.rental.annualManagementFees)],
            ['Autres dépenses annuelles', amount(property.rental.annualOtherExpenses)],
            ['Dépenses annuelles d’exploitation', amount(value.rental.annualOperatingExpenses)],
            [
              'Rendement brut',
              value.rental.grossYield === null
                ? '—'
                : `${Number(value.rental.grossYield).toFixed(2)} %`,
            ],
            [
              'Rendement net avant fiscalité',
              value.rental.netYield === null
                ? '—'
                : `${Number(value.rental.netYield).toFixed(2)} %`,
            ],
            ['Cash-flow mensuel de votre part', amount(value.rental.monthlyCashFlow)],
          ])}
          <p className="small muted">
            Le rendement net exclut le crédit. Le cash-flow déduit la mensualité et l’assurance de
            votre dette. Charges facultatives absentes supposées nulles ; fiscalité et vacance
            locative exclues.
          </p>
        </section>
      )}
    </>
  );
}
