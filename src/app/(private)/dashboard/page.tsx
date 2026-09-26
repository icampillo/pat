import { DashboardPage } from '@/components/pages/dashboard';
import { getPrivateData } from '../_data';
export default async function Page(){const {state}=await getPrivateData();return <DashboardPage state={state}/>;}
