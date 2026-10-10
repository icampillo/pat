import { Suspense } from 'react';
import { WorkspaceProvider } from '@/components/workspace/context';
import { WorkspaceShell } from '@/components/workspace/shell';
import { LoadingProgress } from '@/components/workspace/progress';

// This shell contains no private data. Every data/API request authenticates the session.
export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingProgress />}>
      <WorkspaceProvider>
        <WorkspaceShell>{children}</WorkspaceShell>
      </WorkspaceProvider>
    </Suspense>
  );
}
