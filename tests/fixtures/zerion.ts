// Synthetic fixtures based on official OpenAPI + DeFi recipe retrieved 2026-10-08.
// Not recordings of the owner's wallet; live Fluid coverage remains to be verified.
export const address = `0x${'a'.repeat(40)}`;
export function portfolio(value: string | number = 905) {
  return {
    data: {
      type: 'portfolio',
      id: address,
      attributes: {
        total: { positions: value },
        positions_distribution_by_chain: { ethereum: value },
      },
    },
  };
}
export function position(
  id: string,
  type = 'wallet',
  value: number | null = 100,
  symbol = 'USDC',
  group = id,
) {
  return {
    id,
    type: 'positions',
    attributes: {
      name: id,
      position_type: type,
      protocol: type === 'wallet' ? null : 'Fluid',
      protocol_module: type === 'wallet' ? null : 'lending',
      group_id: group,
      quantity: {
        int: '1234567890123456789',
        decimals: 18,
        numeric: '1.234567890123456789',
        float: 1.2345678901234567,
      },
      value,
      price: value === null ? null : 1,
      fungible_info: {
        name: symbol,
        symbol,
        implementations: [{ chain_id: 'ethereum', address: `0x${id}` }],
      },
      flags: { displayable: true },
      updated_at: '2026-10-01T12:00:00Z',
    },
    relationships: { chain: { data: { id: 'ethereum', type: 'chains' } } },
  };
}
export function fluidPositions() {
  return {
    data: [
      position('usdc', 'wallet', 100),
      position('eth', 'deposit', 600, 'ETH', 'vault'),
      position('steth', 'deposit', 400, 'stETH', 'vault'),
      position('loan', 'loan', 200, 'USDC', 'vault'),
      position('reward', 'reward', 5, 'FLUID', 'vault'),
    ],
  };
}
