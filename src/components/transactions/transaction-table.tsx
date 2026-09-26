'use client';
import { type SaveAction } from '@/components/forms';
import { Confirm } from '@/components/ui/confirm';
import { typeLabels } from '@/shared/schemas';
import type { AppState } from '@/shared/types';
import { Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { date, Empty, money, qty } from '@/components/workspace/display';
export function TransactionTable({
  state,
  rows,
  save,
  run,
}: {
  state: AppState;
  rows: AppState['transactions'];
  save: SaveAction;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Opération</th>
            <th>Actif</th>
            <th className="num">Quantité</th>
            <th className="num">Montant brut</th>
            <th className="num">Frais</th>
            <th>Plateforme</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{date(t.occurredAt)}</td>
              <td>
                <span
                  className={`transaction-type ${t.type === 'BUY' ? 'buy' : t.type === 'SELL' ? 'sell' : ''}`}
                >
                  {typeLabels[t.type]}
                </span>
              </td>
              <td className="strong">{t.assetName}</td>
              <td className="num">{qty(t.quantity)}</td>
              <td className="num">
                {t.type === 'ADJUSTMENT' &&
                state.rows.find((a) => a.id === t.assetId)?.metadata.costBasis === 'UNKNOWN' ? (
                  <span title="Montant non renseigné dans l’inventaire">—</span>
                ) : (
                  money(t.amount, t.currency)
                )}
              </td>
              <td className="num muted">{money(t.fees, t.currency)}</td>
              <td>{t.platform}</td>
              <td>
                {state.rows.find((a) => a.id === t.assetId)?.status === 'ARCHIVED' ? (
                  <Link className="text-link" href={`/assets/${t.assetId}`}>
                    Actif archivé
                  </Link>
                ) : (
                  <>
                    <Link
                      className="icon-btn"
                      href={`/transactions/${t.id}`}
                      aria-label={`Modifier ${typeLabels[t.type]} ${t.assetName}`}
                    >
                      <Pencil size={16} />
                    </Link>
                    <Confirm
                      title="Annuler cette transaction ?"
                      description="Les positions seront recalculées. L’annulation sera refusée si elle rend une autre opération impossible. Une trace sera conservée."
                      onConfirm={() =>
                        run(() =>
                          save(
                            `transactions/${t.id}`,
                            'DELETE',
                            { confirmed: true, reason: 'Annulation confirmée depuis le journal' },
                            t.version,
                          ),
                        )
                      }
                    >
                      <button
                        className="icon-btn"
                        aria-label={`Annuler ${typeLabels[t.type]} ${t.assetName}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </Confirm>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          title="Le journal est vide"
          text="Enregistrez votre premier achat ou dépôt."
          href="/transactions/new"
          label="Ajouter une transaction"
        />
      )}
    </div>
  );
}
