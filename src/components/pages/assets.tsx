'use client';
import { AssetForm } from '@/components/forms';
import type { AppState } from '@/shared/types';
import { useRouter } from 'next/navigation';

import { useWorkspace } from '@/components/workspace/context';
import { PageHeading } from '@/components/workspace/page-heading';

export function NewAssetPage({
  state,
  initialCategory,
}: {
  state: AppState;
  initialCategory?: string;
}) {
  const { save } = useWorkspace();
  const router = useRouter();
  return (
    <>
      <PageHeading view="assets" title="Ajouter un actif" detail />
      <AssetForm
        initialCategory={initialCategory}
        state={state}
        save={save}
        done={(id) => {
          router.push('/assets/' + id);
          router.refresh();
        }}
      />
    </>
  );
}
