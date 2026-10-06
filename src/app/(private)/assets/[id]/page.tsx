'use client';
import { AssetDetailPage } from '@/components/pages/asset-detail';
import { useWorkspace } from '@/components/workspace/context';
import { notFound, useParams } from 'next/navigation';
export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { state } = useWorkspace();
  const asset = state.rows.find((item) => item.id === id && !item.deletedAt);
  if (!asset) notFound();
  return <AssetDetailPage key={id} state={state} asset={asset} />;
}
