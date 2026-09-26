import { WalletsRoutePage } from '@/components/pages/wallets';
import { getPrivateData } from '../_data';
export default async function Page(){const {state}=await getPrivateData();return <WalletsRoutePage state={state}/>;}
