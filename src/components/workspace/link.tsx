'use client';
import NextLink, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';

function Pending() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span
      className="link-pending loading-spinner"
      role="status"
      aria-label="Chargement de la page"
    />
  ) : null;
}

export default function Link({
  children,
  prefetch = false,
  ...props
}: ComponentProps<typeof NextLink>) {
  return (
    <NextLink {...props} prefetch={prefetch}>
      {children}
      <Pending />
    </NextLink>
  );
}
