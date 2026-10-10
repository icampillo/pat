'use client';
import { BusyLabel } from '@/components/ui/busy-label';
import { errorMessage } from '@/shared/errors';
import type { SaveAction } from '@/components/forms';
import type { AppState } from '@/shared/types';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';

export function ZerionSettings({ state, save }: { state: AppState; save: SaveAction }) {
  const config = state.onchain.config;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <section className="panel detail-panel" id="zerion">
      <div className="wallet-title">
        <KeyRound size={20} />
        <h2>Connexion Zerion</h2>
      </div>
      <p className="muted">
        {config.configured
          ? 'Connexion API configurée sur le serveur.'
          : 'Connexion API à configurer sur le serveur. Les dernières valeurs restent conservées.'}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const enabled = new FormData(event.currentTarget).get('enabled') === 'on';
          setBusy(true);
          setMessage('');
          try {
            await save('zerion/config', 'PATCH', { enabled });
            setMessage('Préférences de synchronisation enregistrées.');
          } catch (error) {
            setMessage(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="wallet-check">
          <input name="enabled" type="checkbox" defaultChecked={config.enabled} />
          Synchronisation automatique quotidienne active
        </label>
        <p className="small muted">
          Une synchronisation par jour et par wallet. Actualisation manuelle avec un délai minimal
          de cinq minutes. Deux requêtes par synchronisation normalement, dont une avancée DeFi ;
          chaque page ou nouvelle tentative consomme du quota. Aucun abonnement payant n’est activé
          par l’application.
        </p>
        <button aria-busy={busy} className="btn primary" disabled={busy}>
          <BusyLabel busy={busy} pending="Enregistrement…">
            Enregistrer Zerion
          </BusyLabel>
        </button>
      </form>
      {message && (
        <p role="status" className="wallet-message">
          {message}
        </p>
      )}
    </section>
  );
}
