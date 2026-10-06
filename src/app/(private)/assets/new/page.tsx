'use client';
import { NewAssetPage } from '@/components/pages/assets';
import { useWorkspace } from '@/components/workspace/context';
import { useSearchParams } from 'next/navigation';

export default function Page() {
  const { state } = useWorkspace();
  const category = useSearchParams().get('category');
  const initialCategory = state.categories.find((item) => item.key === category)?.id;
  return <NewAssetPage state={state} initialCategory={initialCategory} />;
}
