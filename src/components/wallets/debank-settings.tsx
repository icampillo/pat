'use client';
import type { SaveAction } from '@/components/forms';
import { Confirm } from '@/components/ui/confirm';
import type { AppState } from '@/shared/types';
import { ExternalLink, KeyRound } from 'lucide-react';
import { useState } from 'react';

export function DeBankSettings({ state, save }: { state: AppState; save: SaveAction }) {
  const config = state.onchain.config;
  const [mode, setMode] = useState(config.mode);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <section className="panel detail-panel" id="debank">
      <div className="wallet-title">
        <KeyRound size={20} />
        <h2>Connexion DeBank</h2>
      </div>
      <p className="muted">
        {mode === 'PUBLIC'
          ? 'Lecture gratuite du profil public : ajoutez une adresse, aucune clé ni inscription requise.'
          : config.hasKey
            ? 'Clé API enregistrée et chiffrée sur le serveur.'
            : 'Mode avancé : l’API officielle nécessite une clé et des crédits DeBank Cloud.'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          setBusy(true);
          setMessage('');
          try {
            await save('debank/config', 'PATCH', {
              mode,
              ...(String(fd.get('key') || '').trim()
                ? { accessKey: String(fd.get('key')).trim() }
                : {}),
              intervalMinutes: Number(fd.get('interval')),
              enabled: fd.get('enabled') === 'on',
            });
            const keyInput = form.elements.namedItem('key') as HTMLInputElement | null;
            if (keyInput) keyInput.value = '';
            setMessage(
              'Configuration enregistrée. Les adresses actives seront synchronisées automatiquement.',
            );
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Mode de récupération
          <select value={mode} onChange={(e) => setMode(e.target.value as 'PUBLIC' | 'API')}>
            <option value="PUBLIC">Gratuit · profil public DeBank</option>
            <option value="API">API officielle · clé et crédits</option>
          </select>
        </label>
        {mode === 'API' && (
          <label>
            Clé API DeBank Cloud
            <input
              name="key"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={512}
              required={!config.hasKey}
              placeholder={
                config.hasKey ? 'Laisser vide pour conserver la clé' : 'Votre AccessKey DeBank'
              }
            />
          </label>
        )}
        <label>
          Fréquence de synchronisation
          <select name="interval" defaultValue={config.intervalMinutes}>
            <option value="15">Toutes les 15 minutes</option>
            <option value="60">Toutes les heures</option>
            <option value="240">Toutes les 4 heures</option>
          </select>
        </label>
        <label className="wallet-check">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={config.configured ? config.enabled : true}
          />
          Synchronisation automatique active
        </label>
        <p className="small muted">
          {mode === 'PUBLIC'
            ? 'Une lecture du profil par synchronisation, sans frais API. La précision et la fraîcheur sont celles affichées par DeBank.'
            : '3 requêtes API par adresse et par synchronisation ; crédits DeBank Cloud nécessaires.'}{' '}
          La synchronisation continue tant que le serveur de l’application fonctionne, même avec le
          navigateur fermé.
        </p>
        <div className="wallet-actions">
          <button className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer DeBank'}
          </button>
          {mode === 'API' && (
            <a
              className="text-link"
              href="https://cloud.debank.com"
              target="_blank"
              rel="noreferrer"
            >
              DeBank Cloud <ExternalLink size={14} />
            </a>
          )}
        </div>
      </form>
      {message && (
        <p role="status" className="wallet-message">
          {message}
        </p>
      )}
      {config.hasKey && (
        <Confirm
          title="Supprimer la clé DeBank ?"
          description="Les synchronisations s’arrêtent. Les adresses et les dernières observations restent conservées."
          onConfirm={async () => {
            try {
              await save('debank/config', 'DELETE', {});
            } catch (error) {
              setMessage((error as Error).message);
            }
          }}
        >
          <button className="text-link wallet-remove">Supprimer la clé enregistrée</button>
        </Confirm>
      )}
    </section>
  );
}
