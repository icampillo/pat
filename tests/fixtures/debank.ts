// Synthetic contract fixtures. These are never used by the application or its seed.
export const address = `0x${'a'.repeat(40)}`;
export const total = {
  total_usd_value: 905,
  chain_list: [{ id: 'eth', name: 'Ethereum', usd_value: 905 }],
};
export const tokens = [
  {
    id: 'usdc',
    chain: 'eth',
    name: 'USD Coin',
    symbol: 'USDC',
    amount: 200,
    price: 1,
    is_wallet: true,
  },
  { id: 'receipt', chain: 'eth', symbol: 'RECEIPT', amount: 500, price: 1, is_wallet: false },
  { id: 'unpriced', chain: 'eth', symbol: 'UNKNOWN', amount: 3, price: 0, is_wallet: true },
];
export const protocols = [
  {
    id: 'lending',
    name: 'Protocol fixture',
    chain: 'eth',
    portfolio_item_list: [
      {
        name: 'Lending',
        stats: { asset_usd_value: 900, debt_usd_value: 200, net_usd_value: 700 },
        update_at: 1750000000,
        detail: {
          supply_token_list: [{ id: 'eth', symbol: 'ETH', amount: 1, price: 890 }],
          borrow_token_list: [{ id: 'usdc', symbol: 'USDC', amount: 200, price: 1 }],
          reward_token_list: [{ id: 'reward', symbol: 'RWD', amount: 10, price: 1 }],
        },
      },
      {
        name: 'Staked',
        stats: { asset_usd_value: 0, debt_usd_value: 0, net_usd_value: 0 },
        // Unknown/new position detail types still retain the official net value.
        update_at: null,
      },
    ],
  },
];
