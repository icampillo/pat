'use client';
import { SettingsPage } from '@/components/pages/settings';
import { useWorkspace } from '@/components/workspace/context';

export default function Page() {
  const { state } = useWorkspace('settings');
  return <SettingsPage state={state} />;
}
