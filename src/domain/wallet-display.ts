import { decimal } from './money';

export function showWalletValue(
  valueUsd: string | null,
  eurUsd: string | null,
  showSmall: boolean,
  valueText?: string,
): boolean {
  if (showSmall) return true;

  if (valueUsd !== null && eurUsd && decimal(eurUsd).gt(0)) {
    return decimal(valueUsd).abs().gte(eurUsd);
  }

  // Masquer les poussières explicitement identifiées par DeBank.
  if (valueText?.trim() === '<$0.01') return false;

  // Valeur inconnue ou taux absent :
  // impossible de confirmer que la ligne vaut moins de 1 €.
  return true;
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
