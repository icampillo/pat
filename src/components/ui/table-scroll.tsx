import type { ReactNode } from 'react';

// A named, keyboard-scrollable region keeps wide financial tables usable on mobile.
export function TableScroll({
  children,
  label,
  className = '',
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={`table-scroll ${className}`} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
