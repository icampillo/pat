import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
}));
import Assets from '../../src/app/(private)/assets/page';
import History from '../../src/app/(private)/history/page';
import Transactions from '../../src/app/(private)/transactions/page';

it.each([
  ['actifs', Assets, '/portfolio'],
  ['transactions', Transactions, '/activity'],
  ['historique', History, '/activity?view=history'],
] as const)('préserve les anciens liens %s vers la bonne sous-vue', (_name, page, target) => {
  expect(() => page()).toThrow(`REDIRECT:${target}`);
});
