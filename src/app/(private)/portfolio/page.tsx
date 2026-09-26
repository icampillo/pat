import { PortfolioPage } from '@/components/pages/portfolio';
import { getPrivateData } from '../_data';
export default async function Page(){const {state}=await getPrivateData();return <PortfolioPage state={state}/>;}
