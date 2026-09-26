import { AssetsPage } from '@/components/pages/assets';
import { getPrivateData } from '../_data';
export default async function Page(){const {state}=await getPrivateData();return <AssetsPage state={state}/>;}
