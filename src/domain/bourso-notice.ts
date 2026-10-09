import { decimal as d, precise } from './money';
import { parseCsvDecimal } from './securities-csv';
import { isinSchema } from './security-identity';
import { csvDate } from './transaction-csv';
import { parisDateTime } from './inventory-date';

const failure = (detail: string) => new Error(`Avis BoursoBank : ${detail}`);

// Deux tableaux textuels connus. Les valeurs sont extraites par section de document,
// puis validées ensemble ; une cellule Frais vide du tableau compact vaut zéro
// uniquement lorsque le net confirme exactement le détail fourni.
function noticeAmounts(content: string, currency: string, type: 'BUY' | 'SELL') {
  const values = (section: string) =>
    [...section.matchAll(/(-?[\d]+(?:[ .]\d{3})*(?:[,.]\d+)?)\s+(EUR|USD)\b/g)].map((match) => {
      if (match[2] !== currency)
        throw failure('devises incohérentes dans le tableau des montants.');
      if (match[1].startsWith('-')) throw failure('montant négatif non pris en charge.');
      return parseCsvDecimal(match[1]);
    });
  const netLabel = /Montant net au (débit|crédit) de votre compte/;
  const direction = content.match(netLabel)?.[1];
  if (direction !== (type === 'BUY' ? 'débit' : 'crédit'))
    throw failure('sens achat/vente incompatible avec le débit/crédit du compte.');
  let gross: string, fees: ReturnType<typeof d>, net: string;
  if (content.includes('Montant transaction brut')) {
    const header =
      'Montant transaction brut Intérêts Montant transaction total brut Courtages Montant transaction net';
    const feeHeader = 'Commission Frais divers Montant total des frais';
    const start = content.indexOf(header),
      middle = content.indexOf(feeHeader);
    const end = content.search(netLabel);
    if (start < 0 || middle <= start || end <= middle)
      throw failure(
        'tableau détaillé incomplet (brut, intérêts, courtages, commission, frais, net attendus).',
      );
    const execution = values(content.slice(start + header.length, middle));
    const costs = values(content.slice(middle + feeHeader.length, end));
    const netValues = values(content.slice(end).split(/Sous réserve/)[0]);
    if (execution.length !== 5 || costs.length !== 3 || netValues.length !== 1)
      throw failure(
        `tableau détaillé : cellules attendues 5/3/1, reçues ${execution.length}/${costs.length}/${netValues.length}.`,
      );
    gross = execution[0];
    net = netValues[0];
    fees = d(execution[3]).add(costs[0]).add(costs[1]);
    if (!d(execution[1]).isZero() || !d(gross).eq(execution[2]) || !fees.eq(costs[2]))
      throw failure('tableau détaillé : intérêts, brut total ou total des frais incohérents.');
    // Certains avis affichent 0 dans « transaction net » (cellule inutilisée).
    const executionNet = d(gross).add(type === 'BUY' ? d(execution[3]) : d(execution[3]).neg());
    if (!d(execution[4]).isZero() && !d(execution[4]).eq(executionNet))
      throw failure('tableau détaillé : montant transaction net incohérent avec les courtages.');
  } else {
    const header =
      /Montant brut Commission Frais(?: \([^)]*\))? Montant net au (?:débit|crédit) de votre compte/;
    const match = header.exec(content);
    if (!match)
      throw failure(
        'format inconnu : tableau détaillé ou tableau compact brut/commission/frais/net attendu.',
      );
    const cells = values(content.slice(match.index + match[0].length).split(/Sous réserve/)[0]);
    if (![3, 4].includes(cells.length))
      throw failure(
        `tableau compact : 3 ou 4 montants attendus (frais facultatifs), ${cells.length} reçus.`,
      );
    gross = cells[0];
    fees = d(cells[1]).add(cells.length === 4 ? cells[2] : '0');
    net = cells[cells.length - 1];
  }
  const expected = d(gross).add(type === 'BUY' ? fees : fees.neg());
  if (expected.lt(0) || !d(net).eq(expected))
    throw failure(
      `montant net ${net} ${currency} incohérent : brut ${gross}, frais ${precise(fees)}, net attendu ${precise(expected)}.`,
    );
  return { gross, fees: precise(fees) };
}

export function parseBoursoNotice(text: string): Record<string, string> {
  const content = text.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  if (
    !/boursorama|boursobank/i.test(content) ||
    (content.match(/Référence\s*:/g) || []).length !== 1
  )
    throw failure('un seul avis textuel avec une référence courtier est requis.');
  const sides = [...content.matchAll(/\b(ACHAT|VENTE) COMPTANT(?: ETR)?\b/g)];
  const execution = content.match(
    /Informations sur l'exécution\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+([\d.,]+)\s+(.+?)\s+Référence\s*:\s*(\d+)/,
  );
  const isin = content.match(/Code ISIN\s*:\s*([A-Z]{2}(?:\s*[A-Z0-9]){9}\s*\d)\b/i);
  const price = content.match(/Cours exécuté\s*:\s*([\d., ]+)\s+(EUR|USD)\b/);
  const venue = content.match(/Lieu d'exécution\s*:\s*(.*?)\s+Montant (?:transaction brut|brut)/);
  if (sides.length !== 1 || !execution || !isin || !price)
    throw failure(
      'identification incomplète : sens, exécution unique, date/heure, quantité, ISIN, prix et référence requis.',
    );
  if (venue?.[1] !== 'EURONEXT PARIS')
    throw failure('seule la place EURONEXT PARIS est prise en charge.');
  const type = sides[0][1] === 'ACHAT' ? 'BUY' : 'SELL';
  const { gross, fees } = noticeAmounts(content, price[2], type);
  const quantity = parseCsvDecimal(execution[3]),
    unitPrice = parseCsvDecimal(price[1]);
  if (
    !d(quantity).gt(0) ||
    !d(unitPrice).gt(0) ||
    d(quantity).mul(unitPrice).sub(gross).abs().gt('0.01')
  )
    throw failure(
      `brut ${gross} incohérent avec quantité ${quantity} × prix ${unitPrice} (tolérance 0,01).`,
    );
  return {
    type,
    isin: isinSchema.parse(isin[1]),
    name: execution[4],
    quantity,
    unit_price: unitPrice,
    amount: gross,
    fees,
    currency: price[2],
    occurred_at: parisDateTime(`${csvDate(execution[1]).slice(0, 10)}T${execution[2]}`),
    external_reference: execution[5],
    settlement: 'EXTERNAL',
    comment: `Avis d’opéré BoursoBank · Euronext Paris · Réf. ${execution[5]}`,
  };
}
