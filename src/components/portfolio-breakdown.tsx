import { sortByValue } from '@/domain/value-sort';
import Link from '@/components/workspace/link';
import { categorySlug } from '@/domain/categories';
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
  const categoryRows = state.categories.map((c) => {
    const rows = held.filter((a) => a.categoryId === c.id);
    const crypto = c.key === 'CRYPTO' && state.onchain.includedCount > 0;
    const walletValue = currency === 'EUR' ? state.onchain.valueEur : state.onchain.valueUsd;
    const manualValue = sum(rows, value);
    const combined = crypto
      ? manualValue === null || walletValue === null
        ? null
        : d(manualValue).add(walletValue).toFixed(2)
      : manualValue;
    const g = crypto ? null : sum(rows, gain);
    return { c, combined, g };
  });
  const currencyRows = ['EUR', 'USD'].map((c) => {
    const cash = state.cash
      .filter((a) => a.currency === c)
      .map((a) => (currency === 'EUR' ? a.valueEur : a.valueUsd));
    const manualValue = sum(
      held.filter((a) => a.currency === c),
      value,
    );
    const walletValue = currency === 'EUR' ? state.onchain.valueEur : state.onchain.valueUsd;
    const combined =
      c === 'USD' && state.onchain.includedCount
        ? manualValue === null || walletValue === null
          ? null
          : d(manualValue).add(walletValue).toFixed(2)
        : manualValue;
    return { c, combined, cash };
  });
  return (
    <>
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
                  <th className="num" aria-sort="descending">
                    Valeur {currency}
                  </th>
                  <th className="num">Gain latent {currency}</th>
                </tr>
              </thead>
              <tbody>
                {sortByValue(categoryRows, (row) => row.combined).map(({ c, combined, g }) => {
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link className="text-link" href={`/categories/${categorySlug(c.key)}`}>
                          {c.label}
                        </Link>
                      </td>
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
                  <th className="num" aria-sort="descending">
                    Actifs
                  </th>
                  <th className="num">Liquidités</th>
                </tr>
              </thead>
              <tbody>
                {sortByValue(currencyRows, (row) => row.combined).map(({ c, combined, cash }) => {
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
