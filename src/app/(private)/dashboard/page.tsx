'use client';
import { DashboardPage } from '@/components/pages/dashboard';
import { useWorkspace } from '@/components/workspace/context';

export default function Page() {
  const { state } = useWorkspace();
  return <DashboardPage state={state} />;
}
