import { auth } from '@/server/auth';
import { getState } from '@/server/portfolio';
import type { AppState } from '@/shared/types';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import 'server-only';
// React cache deduplicates layout/page reads only within this server request.
export const getPrivateData = cache(async () => {
 const session=await auth().api.getSession({headers:await headers()});
 if(!session) redirect('/login');
 const state:AppState=await getState(session.user.id);
 return {state,userName:session.user.name};
});
