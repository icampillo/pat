'use client';
import NextLink, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';
import { LoadingProgress } from './progress';

function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <LoadingProgress /> : null;
}

export default function Link({
  children,
  href,
  prefetch,
  ...props
}: ComponentProps<typeof NextLink>) {
  const pathname = (typeof href === 'string' ? href : (href.pathname ?? '')).split(/[?#]/)[0];
  // Prefetch the bounded navigation (including dynamic categories), never every position row.
  const mainDestination =
    /^\/(dashboard|portfolio|activity|history|wallets|settings)$/.test(pathname) ||
    /^\/categories\/[^/]+$/.test(pathname);
  return (
    <NextLink {...props} href={href} prefetch={prefetch === undefined ? mainDestination : prefetch}>
      {children}
      <Pending />
    </NextLink>
  );
}
