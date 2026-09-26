export const usd = (value: string | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(Number(value));
export const qty = (value: string | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 10 }).format(Number(value));
export const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : 'Jamais';
