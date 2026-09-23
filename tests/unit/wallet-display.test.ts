import { expect, it } from 'vitest';
import { showWalletValue } from '../../src/domain/wallet-display';

it('masque seulement les lignes sous 1 € avec le taux EUR/USD', () => {
  expect(showWalletValue('1.24', '1.25', false)).toBe(false);
  expect(showWalletValue('1.25', '1.25', false)).toBe(true);
  expect(showWalletValue('-0.5', '1.25', false)).toBe(false);
  expect(showWalletValue(null, '1.25', false, '<$0.01')).toBe(false);
  expect(showWalletValue(null, '1.25', false)).toBe(true);
  expect(showWalletValue('0.5', '1.25', true)).toBe(true);
  expect(showWalletValue('0.5', null, false)).toBe(true);
});
