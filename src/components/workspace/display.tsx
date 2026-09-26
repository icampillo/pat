'use client';
import { decimal as d } from '@/domain/money';
import type { AssetView } from '@/shared/types';
import { Shapes } from 'lucide-react';
import Link from 'next/link';
export const money = (value: string | number | null, currency = 'EUR') =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(Number(value));
export const qty = (value: string) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(Number(value));
export const date = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export function AssetAvatar({ asset }: { asset: AssetView }) {
  return (
    <span
      className="asset-avatar"
      style={{ background: `${asset.category.color}15`, color: asset.category.color }}
    >
      {asset.symbol === 'BTC' ? '₿' : asset.symbol === 'ETH' ? 'Ξ' : asset.symbol.slice(0, 2)}
    </span>
  );
}
export function Signed({ value, currency = 'EUR' }: { value: string | null; currency?: string }) {
  return (
    <span className={value !== null ? (d(value).gte(0) ? 'positive' : 'negative') : 'muted'}>
      {value !== null && d(value).gte(0) ? '+' : ''}
      {money(value, currency)}
    </span>
  );
}

export function Metric({
  title,
  value,
  note,
  icon,
  accent = false,
  positive = false,
}: {
  title: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  accent?: boolean;
  positive?: boolean;
}) {
  return (
    <section className={`metric ${accent ? 'accent' : ''}`}>
      <div className="metric-top">
        <span>{title}</span>
        {icon}
      </div>
      <strong className={positive ? 'positive' : ''}>{value}</strong>
      <p>{note}</p>
    </section>
  );
}
export function Empty({
  title,
  text,
  href,
  label,
}: {
  title: string;
  text: string;
  href: string;
  label: string;
}) {
  return (
    <div className="empty">
      <Shapes size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      <Link className="btn primary" href={href}>
        {label}
      </Link>
    </div>
  );
}
