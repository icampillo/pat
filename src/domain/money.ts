import Decimal from 'decimal.js';
export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN });
export type MoneyInput = Decimal.Value;
export const decimal = (value: MoneyInput = 0) => new D(value);
export const precise = (value: MoneyInput) => decimal(value).toDecimalPlaces(18).toFixed();
export function metalValue(
  weight: string,
  purity: string,
  gramPrice: string,
  premium = '0',
  percent = false,
) {
  const intrinsic = decimal(weight).mul(purity).mul(gramPrice);
  return precise(
    percent ? intrinsic.mul(decimal(1).add(decimal(premium).div(100))) : intrinsic.add(premium),
  );
}
