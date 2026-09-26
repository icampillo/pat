'use client';
import { AssetForm } from '@/components/forms';
import { WalletSummary } from '@/components/wallets';
import type { AppState } from '@/shared/types';
import { useRouter } from 'next/navigation';

import { AssetList } from '@/components/assets/asset-list';
import { useWorkspace } from '@/components/workspace/context';
import { PageHeading } from '@/components/workspace/page-heading';

export function AssetsPage({ state }: { state: AppState }) {
  const { currency } = useWorkspace();
  return (
    <>
      <PageHeading view="assets" title="Mes actifs" />
      <AssetList state={state} currency={currency} />
      <WalletSummary state={state} currency={currency} />
    </>
  );
}
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
