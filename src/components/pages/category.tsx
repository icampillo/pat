'use client';
import { ArrowLeft, FileUp, Plus } from 'lucide-react';
import Link from '@/components/workspace/link';
import { CategoryPage } from '@/components/category-page';
import { ImportPanel } from '@/components/import-panel';
import { SecuritiesImportPanel } from '@/components/securities-import-panel';
import { buildCategoryDetails } from '@/domain/categories';
import type { AppState } from '@/shared/types';
import { useWorkspace } from '@/components/workspace/context';
import { PageHeading } from '@/components/workspace/page-heading';

export function CategoryRoutePage({ state, categoryId }: { state: AppState; categoryId: string }) {
  const { currency, save } = useWorkspace();
  const category = state.categories.find((c) => c.id === categoryId)!;
  const details = buildCategoryDetails(state, category, currency);
  const stocks = details.category.slug === 'stocks';
  return (
    <>
      <Link className="back" href="/dashboard">
        <ArrowLeft size={16} aria-hidden="true" />
        Tableau de bord
      </Link>
      <PageHeading
        view="categories"
        title={details.category.name}
        categoryKey={category.key}
        detail
        actions={
          <div className="heading-actions">
            {stocks && (
              <a className="btn" href="#import-bourse">
                <FileUp size={16} aria-hidden="true" />
                Importer un CSV Bourse
              </a>
            )}
            {stocks && (
              <a className="btn" href="#import-transactions">
                Importer des opérations
              </a>
            )}
            <Link
              className="btn primary"
              href={`/assets/new?category=${encodeURIComponent(category.key)}`}
            >
              <Plus size={16} aria-hidden="true" />
              {category.key === 'REAL_ESTATE' ? 'Ajouter un bien' : 'Ajouter un actif'}
            </Link>
          </div>
        }
      />
      <CategoryPage key={categoryId} details={details} currency={currency} asOf={state.asOf} />
      {stocks && (
        <>
          <SecuritiesImportPanel
            accounts={state.accounts ?? []}
            eurUsd={state.fxRate?.eurUsd ?? null}
            save={save}
          />
          <ImportPanel
            accounts={state.accounts ?? []}
            eurUsd={state.fxRate?.eurUsd ?? null}
            save={save}
          />
        </>
      )}
    </>
  );
}
