import { HistoryPage } from '@/components/pages/history';
import { getPrivateData } from '../_data';
export default async function Page(){const {state}=await getPrivateData();return <HistoryPage state={state}/>;}
