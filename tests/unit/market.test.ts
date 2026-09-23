import { expect, it } from 'vitest';
import { coinSpotValue, parseEcbRate, parseMetalSpot } from '../../src/server/market';

it('lit le taux daté de la BCE et rejette une publication périmée', () => {
  const xml = "<Cube time='2026-09-22'><Cube currency='USD' rate='1.1463'/></Cube>";
  expect(parseEcbRate(xml, new Date('2026-09-23T12:00:00Z'))).toEqual({
    eurUsd: '1.1463',
    observedAt: new Date('2026-09-22T00:00:00Z'),
  });
  expect(() => parseEcbRate(xml, new Date('2026-10-01T12:00:00Z'))).toThrow();
});

it('contrôle le métal et convertit l’once troy en métal fin par pièce', () => {
  const observedAt = '2026-09-23T12:00:00Z';
  expect(parseMetalSpot({ symbol: 'XAU', currency: 'USD', price: 3110.34768, updatedAt: observedAt }, 'GOLD', new Date('2026-09-23T12:01:00Z'))).toMatchObject({
    usdPerOunce: '3110.34768',
    observedAt: new Date(observedAt),
  });
  expect(coinSpotValue('6.45', '0.9', '3110.34768', '1')).toBe('580.5');
  expect(() => parseMetalSpot({ symbol: 'XAG', currency: 'USD', price: 3110, updatedAt: observedAt }, 'GOLD', new Date('2026-09-23T12:01:00Z'))).toThrow();
});
