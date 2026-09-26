import { NewAssetPage } from '@/components/pages/assets';
import { getPrivateData } from '../../_data';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { state } = await getPrivateData();
  const { category } = await searchParams;
  const initialCategory = state.categories.find((item) => item.key === category)?.id;
  return <NewAssetPage state={state} initialCategory={initialCategory} />;
}
