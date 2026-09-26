'use client';
import { type SaveAction } from '@/components/forms';
import { ImportPanel } from '@/components/import-panel';
import { SecuritiesImportPanel } from '@/components/securities-import-panel';
import { DeBankSettings } from '@/components/wallets';
import type { AppState } from '@/shared/types';
import { Download } from 'lucide-react';

import { useWorkspace } from '@/components/workspace/context';
import { date } from '@/components/workspace/display';
import { PageHeading } from '@/components/workspace/page-heading';

export function SettingsPage({ state }: { state: AppState }) {
  const { save, run, busy } = useWorkspace();
  return (
    <>
      <PageHeading view="settings" title="Paramètres" />
      <SettingsContent state={state} save={save} run={run} busy={busy} />
    </>
  );
}
function SettingsContent({
  state,
  save,
  run,
  busy,
}: {
  state: AppState;
  save: SaveAction;
  run: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="settings-grid">
      <DeBankSettings state={state} save={save} />
      <section className="panel detail-panel">
        <h2>Votre portefeuille</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() =>
              save('settings', 'PATCH', {
                name: fd.get('name'),
                displayCurrency: fd.get('displayCurrency'),
                timezone: fd.get('timezone'),
              }),
            );
          }}
        >
          <label>
            Nom
            <input name="name" defaultValue={state.portfolio.name} required maxLength={120} />
          </label>
          <label>
            Devise d’affichage par défaut
            <select name="displayCurrency" defaultValue={state.portfolio.displayCurrency}>
              <option>EUR</option>
              <option>USD</option>
            </select>
          </label>
          <label>
            Fuseau horaire
            <select name="timezone" defaultValue={state.portfolio.timezone}>
              <option>Europe/Paris</option>
              <option>UTC</option>
            </select>
          </label>
          <button className="btn primary" disabled={busy}>
            Enregistrer les préférences
          </button>
        </form>
      </section>
      <section className="panel detail-panel">
        <h2>Taux de change</h2>
        <p className="muted">
          {state.fxRate
            ? `Dernier taux : 1 EUR = ${state.fxRate.eurUsd} USD · ${date(state.fxRate.observedAt)} · ${state.fxRate.source === 'ecb' ? 'BCE' : 'saisie manuelle'}`
            : 'Aucun taux EUR/USD renseigné.'}
        </p>
        <button
          className="btn"
          disabled={busy}
          onClick={() => run(() => save('market/refresh', 'POST', {}))}
        >
          Actualiser les cours et le taux
        </button>
        <p className="small muted">
          Mise à jour automatique toutes les 15 minutes lorsque le serveur fonctionne. La valeur des
          pièces repose sur leur métal fin ; elle ne comprend pas de prime numismatique non
          renseignée.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() =>
              save('fx-rates', 'POST', {
                eurUsd: fd.get('eurUsd'),
                observedAt: new Date(String(fd.get('observedAt'))).toISOString(),
              }),
            );
          }}
        >
          <label>
            USD pour 1 EUR
            <input name="eurUsd" required inputMode="decimal" placeholder="1.10" />
          </label>
          <label>
            Date du taux
            <input name="observedAt" type="datetime-local" required />
          </label>
          <button className="btn primary" disabled={busy}>
            Enregistrer le taux
          </button>
        </form>
        <p className="small muted">
          Les transactions et snapshots déjà enregistrés conservent leurs taux historiques.
        </p>
      </section>
      <section className="panel detail-panel">
        <h2>Vos données</h2>
        <p className="muted">Téléchargez une copie privée de votre portefeuille.</p>
        <div className="export-list">
          {[
            ['assets.csv', 'Actifs · CSV'],
            ['transactions.csv', 'Transactions · CSV'],
            ['history.csv', 'Historique · CSV'],
            ['portfolio.json', 'Données complètes · JSON'],
          ].map(([file, label]) => (
            <a key={file} href={`/api/v1/exports/${file}`}>
              <span>{label}</span>
              <Download size={17} />
            </a>
          ))}
        </div>
      </section>
      <section className="panel detail-panel">
        <h2>Sources de prix</h2>
        <div className="provider-row">
          <span>Saisie manuelle</span>
          <span className="tag success">Disponible</span>
        </div>
        <div className="provider-row">
          <span>Wallets crypto · DeBank</span>
          <span className="tag">
            {state.onchain.config.configured
              ? state.onchain.config.enabled
                ? 'Automatique'
                : 'En pause'
              : 'Clé à renseigner'}
          </span>
        </div>
        <div className="provider-row">
          <span>Bourse · Yahoo Finance</span>
          <span className="tag success">Automatique après import CSV</span>
        </div>
        <div className="provider-row">
          <span>Métaux précieux · Gold API</span>
          <span className="tag success">Automatique</span>
        </div>
        {['Cryptos saisies manuellement', 'Cartes de collection'].map((label) => (
          <div className="provider-row" key={label}>
            <span>{label}</span>
            <span className="muted small">API non configurée</span>
          </div>
        ))}
        <p className="small muted">
          Les cours Bourse importés et les métaux sont actualisés toutes les 15 minutes. DeBank
          actualise les adresses ajoutées dans Wallets & DeFi.
        </p>
      </section>
      <ImportPanel save={save} />
      <SecuritiesImportPanel save={save} />
    </div>
  );
}
