import { TransactionEditorPage } from '@/components/pages/transactions';
import { notFound } from 'next/navigation';
import { getPrivateData } from '../../_data';
export default async function Page({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;const {state}=await getPrivateData();
 const transaction=state.transactions.find(item=>item.id===id);
 if(!transaction)notFound();
 return <TransactionEditorPage key={id} state={state} transaction={transaction}/>;
}
