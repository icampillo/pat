import { TransactionsPage } from '@/components/pages/transactions';
import { getPrivateData } from '../_data';
export default async function Page(){const {state}=await getPrivateData();return <TransactionsPage state={state}/>;}
