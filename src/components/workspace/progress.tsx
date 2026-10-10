'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Mounted only while pending: fast operations never paint or announce a loader.
export function LoadingProgress({ label = 'Chargement de la page' }: { label?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 180);
    return () => clearTimeout(timer);
  }, []);
  // Outside the link: its accessible name and any transformed/clipped ancestor stay untouched.
  return visible
    ? createPortal(
        <span className="navigation-progress" role="status" aria-label={label}>
          <span aria-hidden="true" />
        </span>,
        document.body,
      )
    : null;
}
