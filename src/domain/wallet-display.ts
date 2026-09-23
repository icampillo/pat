import { decimal } from './money';

export function showWalletValue(
  valueUsd: string | null,
  eurUsd: string | null,
  showSmall: boolean,
  valueText?: string,
) {
  if (showSmall || !eurUsd) return true;
  if (valueUsd !== null) return decimal(valueUsd).abs().gte(eurUsd);
  // DeBank ne donne parfois qu'une borne textuelle pour les poussières.
  return valueText !== '<$0.01';
}
