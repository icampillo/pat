'use client';
import { CategoryPage } from '@/components/category-page';
import { SecuritiesImportPanel } from '@/components/securities-import-panel';
import { buildCategoryDetails } from '@/domain/categories';
import type { AppState } from '@/shared/types';

import { useWorkspace } from '@/components/workspace/context';
import { PageHeading } from '@/components/workspace/page-heading';

export function CategoryRoutePage({ state, categoryId }: { state: AppState; categoryId: string }) {
  const { currency, save } = useWorkspace();
  const category = state.categories.find((c) => c.id === categoryId)!;
  const details = buildCategoryDetails(state, category, currency);
  return (
    <>
      <PageHeading view="categories" title={details.category.name} detail />
      {details.category.slug === 'stocks' && <SecuritiesImportPanel save={save} />}
      <CategoryPage key={categoryId} details={details} currency={currency} asOf={state.asOf} />
    </>
  );
}
