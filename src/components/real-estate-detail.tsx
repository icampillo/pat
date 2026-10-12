'use client';
import { TableScroll } from '@/components/ui/table-scroll';
import { sortByValue } from '@/domain/value-sort';
import { useState } from 'react';
import { decimal as d } from '@/domain/money';
import { amortization } from '@/domain/mortgage';
import { propertyTypes, propertyUsages, propertyMortgages } from '@/shared/real-estate';
import type { AssetView } from '@/shared/types';
import { date, money } from './workspace/display';
import { PriceHistoryList } from './assets/price-history';

export function RealEstateDetail({ asset }: { asset: AssetView }) {
  const property = asset.metadata.realEstate!;
  const value = asset.realEstate!;
  const [page, setPage] = useState(0);
  const [loanIndex, setLoanIndex] = useState(0);
  const loans = propertyMortgages(property);
  const loan = loans[loanIndex];
  const finance = value.mortgages[loanIndex];
  const rows = loan ? amortization(loan) : [];
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
  return (
    <>
      <div className="metrics">
        {[
          ['Capital déjà remboursé', value.principalPaid],
          ['Valeur brute détenue', value.ownedValue],
          ['Capital restant dû', value.remainingPrincipal],
          ['Patrimoine immobilier net', value.equity],
        ].map(([label, result]) => (
          <section className="metric" key={label}>
            <div className="metric-top">{label}</div>
            <strong>{amount(result)}</strong>
          </section>
        ))}
      </div>
      {asset.price === null && (
        <p className="notice">
          Valeur actuelle inconnue : renseignez une estimation pour calculer le patrimoine net.
        </p>
      )}
      {asset.price !== null &&
        Number(asset.price) === 0 &&
        Number(value.remainingPrincipal) > 0 && (
          <p className="notice">
            La valeur du bien est enregistrée à zéro : le patrimoine net correspond donc à l’opposé
            de la dette. Vérifiez l’estimation du bien.
          </p>
        )}
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
            ['Acquisition', date(property.purchaseDate)],
            ['Prix d’acquisition du bien', amount(property.purchasePrice)],
            ['Valeur actuelle estimée du bien entier', amount(asset.price)],
            ['Montant initial des crédits', amount(value.borrowedAmount)],
            ['Frais d’acquisition', amount(property.acquisitionFees)],
            ['Travaux initiaux', amount(property.initialRenovations)],
            ['Coût d’acquisition du bien', amount(value.acquisitionCost)],
            ['Prix d’acquisition détenu', amount(value.acquisitionOwnedValue)],
            ['Plus-value / moins-value latente, hors frais', amount(value.grossGain)],
            ['Dernière estimation', asset.priceDate ? date(asset.priceDate) : 'Inconnue'],
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
          {value.progressPercent !== null && (
            <label>
              Capital remboursé, tous crédits :{' '}
              {Number(value.progressPercent).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{' '}
              %
              <progress max={100} value={Number(value.progressPercent)} />
            </label>
          )}
          {loans.length > 1 && (
            <label>
              Crédit affiché
              <select
                aria-label="Crédit affiché"
                value={loanIndex}
                onChange={(event) => {
                  setLoanIndex(Number(event.target.value));
                  setPage(0);
                }}
              >
                {loans.map((item, index) => (
                  <option key={index} value={index}>
                    Crédit {index + 1} · {amount(item.borrowedAmount)} · {date(item.startDate)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {loan && finance ? (
            <>
              {metrics([
                ['Montant emprunté attribué', amount(loan.borrowedAmount)],
                ['Apport personnel', amount(loan.downPayment)],
                ['Taux nominal annuel', `${loan.annualInterestRate} %`],
                ['Durée', `${loan.durationMonths} mois`],
                ['Début du prêt', date(loan.startDate)],
                ['Mensualité hors assurance', amount(finance.monthlyPayment)],
                ['Assurance mensuelle', amount(loan.monthlyInsurance)],
                ['Capital remboursé', amount(finance.principalPaid)],
                ['Capital restant dû', amount(finance.remainingPrincipal)],
                [
                  'Source du solde',
                  finance.balanceSource === 'MANUAL'
                    ? `Relevé manuel du ${date(finance.balanceDate!)}`
                    : 'Échéancier automatique',
                ],
                ['Intérêts payés estimés (contrat initial)', amount(finance.interestPaid)],
                ['Intérêts futurs estimés', amount(finance.interestRemaining)],
                ['Intérêts totaux', amount(finance.totalInterest)],
                ['Assurance payée estimée (contrat initial)', amount(finance.insurancePaid)],
                ['Assurance restante', amount(finance.insuranceRemaining)],
                ['Assurance totale estimée', amount(finance.totalInsurance)],
                ['Frais de dossier / garantie', amount(loan.originationFees)],
                ['Coûts déjà supportés (hors capital)', amount(finance.costsPaid)],
                ['Coûts futurs prévisionnels', amount(finance.costsRemaining)],
                ['Coût total prévisionnel du crédit', amount(finance.totalCost)],
                ['Échéances restantes du contrat initial', String(finance.remainingPayments)],
                ['Fin théorique', date(finance.endDate)],
              ])}
              <label>
                Capital remboursé : {finance.progressPercent} %
                <progress max={100} value={Number(finance.progressPercent)} />
              </label>
              <p className="small muted">
                {finance.balanceSource === 'MANUAL'
                  ? 'Capital issu du dernier relevé, remboursements anticipés inclus. Ce solde reste fixe jusqu’au prochain relevé. Intérêts, assurance, mensualité et dates ci-dessus restent les prévisions du contrat initial, non recalculées après remboursement anticipé.'
                  : 'Échéances supposées payées à la date prévue. Prêt à taux fixe. Les coûts excluent le remboursement du capital.'}
              </p>
              {!!loan.balanceObservations?.length && (
                <>
                  <h3>Historique des relevés de capital</h3>
                  <TableScroll label="Relevés de capital restant dû">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Capital restant dû</th>
                          <th>Capital déjà remboursé</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loan.balanceObservations.map((item) => (
                          <tr key={item.date}>
                            <td>{date(item.date)}</td>
                            <td>{amount(item.remainingPrincipal)}</td>
                            <td>
                              {amount(
                                d(loan.borrowedAmount).sub(item.remainingPrincipal).toFixed(2),
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                </>
              )}
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
              <p>
                Prévision du contrat initial · crédit {loanIndex + 1} · 12 échéances par page ·{' '}
                {asset.currency}
              </p>
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
          <TableScroll label="Échéancier du crédit">
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
                    <th
                      key={title}
                      aria-sort={title === 'Capital restant' ? 'descending' : undefined}
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortByValue(rows, (row) => row.remainingPrincipal)
                  .slice(page * 12, (page + 1) * 12)
                  .map((row) => (
                    <tr key={row.number}>
                      <td>{row.number}</td>
                      <td>{date(row.date)}</td>
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
          </TableScroll>
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
                : new Intl.NumberFormat('fr-FR', {
                    style: 'percent',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(Number(value.rental.grossYield) / 100),
            ],
            [
              'Rendement net avant fiscalité',
              value.rental.netYield === null
                ? '—'
                : new Intl.NumberFormat('fr-FR', {
                    style: 'percent',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(Number(value.rental.netYield) / 100),
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
