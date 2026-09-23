import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/server/auth';
import { getState } from '@/server/portfolio';
import { Workspace } from '@/components/workspace';
import { categorySlug } from '@/domain/categories';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (!path.length) redirect('/dashboard');
  if (
    ![
      'dashboard',
      'portfolio',
      'assets',
      'transactions',
      'history',
      'settings',
      'wallets',
      'categories',
    ].includes(path[0]) ||
    path.length > 2 ||
    (path.length === 2 && !['assets', 'transactions', 'categories'].includes(path[0])) ||
    (path[0] === 'categories' && path.length !== 2)
  )
    notFound();
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const state = await getState(session.user.id);
  if (
    path[0] === 'categories' &&
    !state.categories.some((category: { key: string }) => categorySlug(category.key) === path[1])
  )
    notFound();
  if (
    path[0] !== 'categories' &&
    path[1] &&
    path[1] !== 'new' &&
    (path[0] === 'transactions'
      ? !state.transactions.some((t: { id: string }) => t.id === path[1])
      : !state.rows.some(
          (a: { id: string; deletedAt: string | null }) => a.id === path[1] && !a.deletedAt,
        ))
  )
    notFound();
  return <Workspace initialState={state} path={path} userName={session.user.name} />;
}
