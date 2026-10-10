import type { ReactNode } from 'react';

// Both labels participate in sizing; only the current one is exposed to assistive technology.
export function BusyLabel({
  busy,
  children,
  pending = 'Enregistrement…',
}: {
  busy: boolean;
  children: ReactNode;
  pending?: string;
}) {
  return (
    <span className="busy-label" aria-busy={busy}>
      <span aria-hidden={busy}>{children}</span>
      <span aria-hidden={!busy}>{pending}</span>
    </span>
  );
}
