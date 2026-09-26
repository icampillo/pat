'use client';
import { Camera, Download, Plus, X } from 'lucide-react';
import Link from 'next/link';

import { useWorkspace } from '@/components/workspace/context';

export function PageHeading({
  view,
  title,
  detail = false,
}: {
  view: string;
  title: string;
  detail?: boolean;
}) {
  const { save, run, busy, flash, setFlash } = useWorkspace();
  return (
    <>
      {' '}
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {view === 'dashboard' ? 'VOTRE PATRIMOINE EN UN REGARD' : 'VOTRE ESPACE PERSONNEL'}
          </p>
          <h1>{title}</h1>
          <p className="subtitle">
            {view === 'dashboard'
              ? 'Suivez vos investissements et vos collections, simplement.'
              : view === 'assets'
                ? 'Chaque investissement a sa place.'
                : view === 'transactions'
                  ? 'Le journal de vos achats, ventes et mouvements.'
                  : view === 'history'
                    ? 'Des valeurs conservées, une évolution lisible.'
                    : view === 'settings'
                      ? 'Les préférences et les données de votre espace.'
                      : 'Vos positions et leur répartition.'}
          </p>
        </div>
        {!detail && !['settings', 'wallets'].includes(view) && (
          <div className="heading-actions">
            {['dashboard', 'assets'].includes(view) && (
              <Link className="btn" href="/categories/stocks#import-bourse">
                Importer un CSV Bourse
              </Link>
            )}
            {view === 'dashboard' || view === 'history' ? (
              <button
                className="btn"
                disabled={busy}
                onClick={() => run(() => save('snapshots', 'POST', {}))}
              >
                <Camera size={16} />
                Enregistrer un snapshot
              </button>
            ) : (
              <a
                className="btn"
                href={`/api/v1/exports/${view === 'transactions' ? 'transactions' : 'assets'}.csv`}
              >
                <Download size={16} />
                Exporter
              </a>
            )}
            <Link
              className="btn primary"
              href={view === 'transactions' ? '/transactions/new' : '/assets/new'}
            >
              <Plus size={17} />
              {view === 'transactions' ? 'Nouvelle transaction' : 'Ajouter un actif'}
            </Link>
          </div>
        )}
      </div>
      {flash && (
        <div className="notice" role="status">
          <span>{flash}</span>
          <button className="icon-btn" aria-label="Fermer le message" onClick={() => setFlash('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
