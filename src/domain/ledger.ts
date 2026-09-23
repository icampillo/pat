import { decimal as d, precise } from './money';
import type Decimal from 'decimal.js';

export type LedgerTransaction = {
  id: string;
  assetId: string | null;
  type: string;
  quantity: string;
  unitPrice: string;
  fees: string;
  amount: string;
  currency: string;
  fxToEur: string;
  fxToUsd: string | null;
  platform: string;
  destination: string | null;
  settlement: string;
  occurredAt: string;
  sequence: number;
};
type Balance = {
  quantity: Decimal;
  cost: Decimal;
  costUsd: Decimal | null;
  realized: Decimal;
  realizedUsd: Decimal | null;
  income: Decimal;
  places: Record<string, Decimal>;
};
export class LedgerError extends Error {}
export function replay(transactions: LedgerTransaction[]) {
  const assets: Record<string, Balance> = {};
  const cash: Record<string, Decimal> = {};
  let netFlows = d(0),
    income = d(0),
    expenses = d(0),
    purchases = d(0);
  const flows: { amount: string; date: string }[] = [];
  const flow = (amount: Decimal, date: string) => {
    netFlows = netFlows.add(amount);
    flows.push({ amount: precise(amount), date });
  };
  const cashMove = (currency: string, platform: string, delta: Decimal) => {
    const key = JSON.stringify([currency, platform]);
    cash[key] = (cash[key] || d(0)).add(delta);
    if (cash[key].lt(0))
      throw new LedgerError(`Liquidités ${currency} insuffisantes sur ${platform}.`);
  };
  for (const tx of [...transactions].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sequence - b.sequence,
  )) {
    const q = d(tx.quantity),
      p = d(tx.unitPrice),
      fee = d(tx.fees),
      amount = d(tx.amount),
      eur = d(tx.fxToEur);
    const usd = tx.fxToUsd ? d(tx.fxToUsd) : null;
    const gross = q.abs().mul(p),
      eurGross = gross.mul(eur);
    const a = tx.assetId
      ? (assets[tx.assetId] ||= {
          quantity: d(0),
          cost: d(0),
          costUsd: d(0),
          realized: d(0),
          realizedUsd: d(0),
          income: d(0),
          places: {},
        })
      : null;
    const move = (delta: Decimal, place = tx.platform) => {
      if (!a) throw new LedgerError('Actif obligatoire.');
      a.places[place] = (a.places[place] || d(0)).add(delta);
      if (a.places[place].lt(0)) throw new LedgerError(`Quantité insuffisante sur ${place}.`);
      a.quantity = a.quantity.add(delta);
    };
    const addCost = (native: Decimal) => {
      if (!a) throw new LedgerError('Actif obligatoire.');
      a.cost = a.cost.add(native.mul(eur));
      a.costUsd = usd && a.costUsd !== null ? a.costUsd.add(native.mul(usd)) : null;
    };
    const removeCost = (qty: Decimal) => {
      if (!a || a.quantity.lt(qty) || qty.lte(0))
        throw new LedgerError('Quantité détenue insuffisante.');
      const all = qty.eq(a.quantity);
      const cost = all ? a.cost : a.cost.mul(qty).div(a.quantity);
      const costUsd =
        a.costUsd === null ? null : all ? a.costUsd : a.costUsd.mul(qty).div(a.quantity);
      a.cost = a.cost.sub(cost);
      if (a.costUsd !== null && costUsd !== null) a.costUsd = a.costUsd.sub(costUsd);
      move(qty.neg());
      if (a.quantity.isZero()) {
        a.cost = d(0);
        a.costUsd = d(0);
      }
      return { cost, costUsd };
    };
    switch (tx.type) {
      case 'BUY': {
        const total = gross.add(fee);
        move(q);
        addCost(total);
        purchases = purchases.add(total.mul(eur));
        if (tx.settlement === 'EXTERNAL') flow(total.mul(eur), tx.occurredAt);
        else cashMove(tx.currency, tx.platform, total.neg());
        break;
      }
      case 'SELL': {
        const removed = removeCost(q),
          net = gross.sub(fee);
        if (net.lt(0)) throw new LedgerError('Les frais dépassent le produit de vente.');
        a!.realized = a!.realized.add(net.mul(eur).sub(removed.cost));
        a!.realizedUsd =
          usd && removed.costUsd !== null && a!.realizedUsd !== null
            ? a!.realizedUsd.add(net.mul(usd).sub(removed.costUsd))
            : null;
        if (tx.settlement === 'EXTERNAL') flow(net.mul(eur).neg(), tx.occurredAt);
        else cashMove(tx.currency, tx.platform, net);
        break;
      }
      case 'DEPOSIT':
      case 'WITHDRAWAL': {
        const incoming = tx.type === 'DEPOSIT';
        if (a) {
          if (incoming) {
            move(q);
            addCost(gross);
          } else removeCost(q);
        } else cashMove(tx.currency, tx.platform, incoming ? amount : amount.neg());
        const value = (a ? amount : amount).mul(eur);
        flow(incoming ? value : value.neg(), tx.occurredAt);
        break;
      }
      case 'TRANSFER': {
        if (!tx.destination || tx.destination === tx.platform)
          throw new LedgerError('Choisissez deux plateformes distinctes.');
        if (a) {
          move(q.neg());
          move(q, tx.destination);
        } else {
          cashMove(tx.currency, tx.platform, amount.neg());
          cashMove(tx.currency, tx.destination, amount);
        }
        break;
      }
      case 'DIVIDEND': {
        cashMove(tx.currency, tx.platform, amount);
        const value = amount.mul(eur);
        income = income.add(value);
        if (a) a.income = a.income.add(value);
        break;
      }
      case 'REWARD': {
        move(q);
        addCost(gross);
        income = income.add(eurGross);
        a!.income = a!.income.add(eurGross);
        break;
      }
      case 'FEE': {
        if (a) {
          const removed = removeCost(q);
          a.realized = a.realized.add(eurGross.sub(removed.cost));
          expenses = expenses.add(eurGross);
        } else {
          cashMove(tx.currency, tx.platform, amount.neg());
          expenses = expenses.add(amount.mul(eur));
        }
        break;
      }
      case 'ADJUSTMENT': {
        if (q.gt(0)) {
          move(q);
          addCost(gross);
          flow(eurGross, tx.occurredAt);
        } else {
          removeCost(q.abs());
          flow(eurGross.neg(), tx.occurredAt);
        }
        break;
      }
      default:
        throw new LedgerError('Type de transaction inconnu.');
    }
  }
  return {
    assets: Object.fromEntries(
      Object.entries(assets).map(([id, a]) => [
        id,
        {
          quantity: precise(a.quantity),
          costEur: precise(a.cost),
          costUsd: a.costUsd === null ? null : precise(a.costUsd),
          averageEur: a.quantity.gt(0) ? precise(a.cost.div(a.quantity)) : '0',
          realizedEur: precise(a.realized),
          realizedUsd: a.realizedUsd === null ? null : precise(a.realizedUsd),
          incomeEur: precise(a.income),
          places: Object.fromEntries(
            Object.entries(a.places).map(([key, value]) => [key, precise(value)]),
          ),
        },
      ]),
    ),
    cash: Object.entries(cash).map(([key, value]) => {
      const [currency, platform] = JSON.parse(key) as string[];
      return { currency, platform, balance: precise(value) };
    }),
    netFlowsEur: precise(netFlows),
    purchasesEur: precise(purchases),
    incomeEur: precise(income),
    expensesEur: precise(expenses),
    flows,
  };
}

export function dietz(
  startValue: string,
  endValue: string,
  start: string,
  end: string,
  flows: { date: string; amount: string }[],
) {
  const duration = Date.parse(end) - Date.parse(start);
  if (duration <= 0) return null;
  let total = d(0),
    weighted = d(0);
  for (const f of flows) {
    const timestamp = Date.parse(f.date);
    if (timestamp <= Date.parse(start) || timestamp > Date.parse(end)) continue;
    total = total.add(f.amount);
    weighted = weighted.add(
      d(f.amount)
        .mul(Date.parse(end) - timestamp)
        .div(duration),
    );
  }
  const denominator = d(startValue).add(weighted);
  return denominator.gt(0)
    ? precise(d(endValue).sub(startValue).sub(total).div(denominator).mul(100))
    : null;
}
