'use client';
import type { SaveAction } from '@/components/forms';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export function WalletAddForm({
  save,
  busy,
  run,
}: {
  save: SaveAction;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const params = useSearchParams();
  return (
    <section className="panel detail-panel wallet-add">
      <h2>Ajouter une adresse</h2>
      <p className="muted">
        Les réseaux compatibles et les protocoles DeFi sont détectés par DeBank. Aucun portefeuille
        à connecter ni signature à fournir.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          void run(async () => {
            await save('wallets', 'POST', {
              address: fd.get('address'),
              label: fd.get('label'),
              included: fd.get('included') === 'on',
              ...(fd.get('reference') ? { referenceUsd: fd.get('reference') } : {}),
            });
            form.reset();
          });
        }}
      >
        <div className="wallet-form-grid">
          <label>
            Adresse publique ou profil DeBank
            <input
              name="address"
              required
              maxLength={250}
              placeholder="0x… ou https://debank.com/profile/…"
              defaultValue={params.get('address') || ''}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label>
            Nom du wallet (facultatif)
            <input name="label" maxLength={80} placeholder="Mon wallet principal" />
          </label>
        </div>
        <details>
          <summary className="text-link">Options de suivi et de comparaison</summary>
          <label>
            Valeur de référence en dollars (facultatif)
            <input
              name="reference"
              type="number"
              min="0"
              max="999999999999999"
              step="0.01"
              defaultValue={params.get('reference') || ''}
              placeholder="Montant observé sur DeBank"
            />
          </label>
          <p className="small muted">
            Repère de comparaison uniquement : il ne remplace jamais la valeur récupérée.
          </p>
        </details>
        <label className="wallet-check">
          <input name="included" type="checkbox" defaultChecked />
          Inclure cette adresse dans le patrimoine
        </label>
        <p className="small muted">
          Les actifs déjà saisis manuellement restent comptés. Excluez ce wallet du total si ses
          positions sont déjà représentées dans vos saisies.
        </p>
        <button className="btn primary" disabled={busy}>
          <Plus size={16} />
          Ajouter le wallet
        </button>
      </form>
    </section>
  );
}
