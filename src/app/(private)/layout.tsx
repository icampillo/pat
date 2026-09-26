import { WorkspaceProvider } from '@/components/workspace/context';
import { WorkspaceShell } from '@/components/workspace/shell';
import { getPrivateData } from './_data';
export const dynamic='force-dynamic';
export default async function PrivateLayout({children}:{children:React.ReactNode}) {
 const {state,userName}=await getPrivateData();
 return <WorkspaceProvider state={state}><WorkspaceShell state={state} userName={userName}>{children}</WorkspaceShell></WorkspaceProvider>;
}
