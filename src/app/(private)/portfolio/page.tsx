'use client';
import { PortfolioPage } from '@/components/pages/portfolio';
import { useWorkspace } from '@/components/workspace/context';

export default function Page() {
  const { state } = useWorkspace();
  return <PortfolioPage state={state} />;
}
