import { FileUp, Plus, X } from 'lucide-react';
import Link from '@/components/workspace/link';
import { useWorkspace } from '@/components/workspace/context';
import { dashboardAction, dashboardPrimaryAction } from './primitives';

export function DashboardHeader() {
  const { flash, setFlash } = useWorkspace();
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl! tracking-tight!">Vue d’ensemble</h1>
          <p className="mt-1! text-xs text-(--muted)">Votre patrimoine, en perspective.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Actions du dashboard">
          <Link className={dashboardAction} href="/categories/stocks#import-bourse">
            <FileUp size={15} aria-hidden="true" />
            Importer un CSV Bourse
          </Link>
          <Link className={dashboardPrimaryAction} href="/assets/new">
            <Plus size={16} aria-hidden="true" />
            Ajouter un actif
          </Link>
        </div>
      </header>
      {flash && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-(--line) bg-(--accent-soft) p-3 text-sm"
          role="status"
        >
          <span>{flash}</span>
          <button
            className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-(--surface)"
            aria-label="Fermer le message"
            onClick={() => setFlash('')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
