import { ChartNoAxesColumnIncreasing, Coins, Gem, House, Layers3, Wallet } from 'lucide-react';
import type { CSSProperties } from 'react';

// Visual identity from the validated dashboard. Never changes stored category data.
export function categoryAppearance(key: string) {
  key =
    key === 'stocks'
      ? 'SECURITIES'
      : key === 'precious-metals'
        ? 'METALS'
        : key.replaceAll('-', '_').toUpperCase();
  const known = {
    CRYPTO: { color: '#763cff', soft: '#dcd0ff', Icon: Coins },
    SECURITIES: { color: '#ee775e', soft: '#ffdbd1', Icon: ChartNoAxesColumnIncreasing },
    METALS: { color: '#bd850c', soft: '#fff0bc', Icon: Gem },
    CASH: { color: '#168ee0', soft: '#cfebfc', Icon: Wallet },
    REAL_ESTATE: { color: '#6974c8', soft: '#e0e3fa', Icon: House },
  };
  if (key in known) return known[key as keyof typeof known];
  const hues = [265, 215, 310, 38, 235, 285];
  const hash = [...key].reduce((value, ch) => (value * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const hue = hues[hash % hues.length];
  return { color: `hsl(${hue} 45% 43%)`, soft: `hsl(${hue} 65% 90%)`, Icon: Layers3 };
}

export function categoryStyle(key: string): CSSProperties {
  const { color, soft } = categoryAppearance(key);
  return { '--category-color': color, '--category-soft': soft } as CSSProperties;
}
