import { decimal as d } from '@/domain/money';
import type { AppState, AssetView } from '@/shared/types';
const money = (v: string | null, currency: string) =>
  v === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(v));
export function PortfolioBreakdown({
  state,
  currency,
}: {
  state: AppState;
  currency: 'EUR' | 'USD';
}) {
  const value = (a: AssetView) => (currency === 'EUR' ? a.valueEur : a.valueUsd);
  const gain = (a: AssetView) => (currency === 'EUR' ? a.gainEur : a.gainUsd);
  const held = state.rows.filter((a) => d(a.quantity).gt(0));
  const sum = (rows: AssetView[], field: (a: AssetView) => string | null) =>
    rows.some((a) => field(a) === null)
      ? null
      : rows.reduce((sum, a) => sum.add(field(a)!), d(0)).toFixed(2);
  const overall =
    state.onchain.includedCount > 0 ||
    state.totals.incompleteCostBasis ||
    state.totals.valueEur === null
      ? null
      : d(state.totals.valueEur).sub(state.totals.netFlowsEur).toFixed(2);
  return (
    <>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Résultat global</h2>
            <p>
              {state.onchain.includedCount || state.totals.incompleteCostBasis
                ? 'Indisponible : certains coûts d’achat ou apports ne sont pas renseignés.'
                : 'Patrimoine actuel moins apports nets · inclut les revenus, frais et cessions'}
            </p>
          </div>
          <strong className={overall !== null && d(overall).lt(0) ? 'negative' : 'positive'}>
            {money(overall, 'EUR')}
          </strong>
        </div>
        <div className="section-title">
          <span className="muted">Achats saisis cumulés, frais inclus</span>
          <strong>{money(state.totals.purchasesEur, 'EUR')}</strong>
        </div>
      </section>
      <div className="detail-grid">
        <section className="panel">
          <div className="section-title">
            <h2>Résultats par catégorie</h2>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Catégorie</th>
                  <th className="num">Valeur {currency}</th>
                  <th className="num">Gain latent {currency}</th>
                </tr>
              </thead>
              <tbody>
                {state.categories.map((c) => {
                  const rows = held.filter((a) => a.categoryId === c.id);
                  const crypto = c.key === 'CRYPTO' && state.onchain.includedCount > 0;
                  const walletValue =
                    currency === 'EUR' ? state.onchain.valueEur : state.onchain.valueUsd;
                  const manualValue = sum(rows, value);
                  const combined = crypto
                    ? manualValue === null || walletValue === null
                      ? null
                      : d(manualValue).add(walletValue).toFixed(2)
                    : manualValue;
                  const g = crypto ? null : sum(rows, gain);
                  return (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td className="num">{money(combined, currency)}</td>
                      <td className={`num ${g !== null && d(g).lt(0) ? 'negative' : 'positive'}`}>
                        {money(g, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>Répartition par devise</h2>
              <p>Devise de cotation · valeur convertie en {currency}</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Devise</th>
                  <th className="num">Actifs</th>
                  <th className="num">Liquidités</th>
                </tr>
              </thead>
              <tbody>
                {['EUR', 'USD'].map((c) => {
                  const cash = state.cash
                    .filter((a) => a.currency === c)
                    .map((a) => (currency === 'EUR' ? a.valueEur : a.valueUsd));
                  const manualValue = sum(
                    held.filter((a) => a.currency === c),
                    value,
                  );
                  const walletValue =
                    currency === 'EUR' ? state.onchain.valueEur : state.onchain.valueUsd;
                  const combined =
                    c === 'USD' && state.onchain.includedCount
                      ? manualValue === null || walletValue === null
                        ? null
                        : d(manualValue).add(walletValue).toFixed(2)
                      : manualValue;
                  return (
                    <tr key={c}>
                      <td>{c}</td>
                      <td className="num">{money(combined, currency)}</td>
                      <td className="num">
                        {money(
                          cash.some((v) => v === null)
                            ? null
                            : cash.reduce<string>((sum, v) => d(sum).add(v!).toFixed(), '0'),
                          currency,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
