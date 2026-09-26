import { AssetDetailPage } from '@/components/pages/asset-detail';
import { notFound } from 'next/navigation';
import { getPrivateData } from '../../_data';
export default async function Page({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;const {state}=await getPrivateData();
 const asset=state.rows.find(item=>item.id===id && !item.deletedAt);
 if(!asset)notFound();
 return <AssetDetailPage key={id} state={state} asset={asset}/>;
}
