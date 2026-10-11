
import { decimal } from './money';

export function showWalletValue(
  valueUsd: string | null,
  eurUsd: string | null,
  showSmall: boolean,
  _valueText?: string,
): boolean {
  if (showSmall) return true;

  if (valueUsd === null || valueUsd.trim() === '') {
    return false;
  }

  const value = decimal(valueUsd).abs();

  if (!value.isFinite() || value.isZero()) {
    return false;
  }

  if (!eurUsd || decimal(eurUsd).lte(0)) {
    return true;
  }

  return value.gte(eurUsd);
}


// import { decimal } from './money';

// export function showWalletValue(
//   valueUsd: string | null,
//   eurUsd: string | null,
//   showSmall: boolean,
//   valueText?: string,
// ) {
//   if (showSmall || !eurUsd) return true;
//   if (valueUsd !== null) return decimal(valueUsd).abs().gte(eurUsd);
//   // DeBank ne donne parfois qu'une borne textuelle pour les poussières.
//   return valueText !== '<$0.01';
// }
