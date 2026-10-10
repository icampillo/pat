import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import Link from '@/components/workspace/link';
import { BusyLabel } from '@/components/ui/busy-label';
import { WorkspaceLoading } from '@/components/workspace/loading';

const observe = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  default: (props: ComponentProps<typeof Link>) => {
    observe(props);
    return null;
  },
  useLinkStatus: () => ({ pending: false }),
}));

it.each([
  '/dashboard',
  '/portfolio',
  '/activity?view=history',
  '/wallets',
  '/settings#zerion',
  '/categories/crypto',
])('prefetches bounded navigation %s natively', (href) => {
  renderToStaticMarkup(<Link href={href}>Ouvrir</Link>);
  expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ prefetch: true }));
});
it.each([
  '/assets/123',
  '/transactions/123',
  '/assets/new?category=CRYPTO',
  '/api/v1/exports/history.csv',
  'https://example.org/dashboard',
])('does not prefetch individual rows or unrelated destinations %s', (href) => {
  renderToStaticMarkup(<Link href={href}>Ouvrir</Link>);
  expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ prefetch: false }));
});
it.each([true, false, null] as const)(
  'preserves explicit prefetch=%s and URL objects',
  (prefetch) => {
    renderToStaticMarkup(
      <Link href={{ pathname: '/assets/123' }} prefetch={prefetch}>
        Ouvrir
      </Link>,
    );
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ prefetch }));
  },
);
it('keeps both action labels mounted and exposes only the current one', () => {
  for (const busy of [false, true]) {
    const html = renderToStaticMarkup(<BusyLabel busy={busy}>Enregistrer le bien</BusyLabel>);
    expect(html).toContain('<span aria-hidden="' + busy + '">Enregistrer le bien</span>');
    expect(html).toContain('<span aria-hidden="' + !busy + '">Enregistrement…</span>');
  }
});
it('distinguishes initial activity history from transactions without fake data', () => {
  const transactions = renderToStaticMarkup(<WorkspaceLoading pathname="/activity" />);
  const history = renderToStaticMarkup(<WorkspaceLoading pathname="/activity" history />);
  expect(transactions).not.toContain('skeleton-plot');
  expect(history).toContain('skeleton-plot');
  expect(history).toContain('aria-busy="true"');
  expect(history).not.toContain('loading-spinner');
});
