'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { allocationRects } from '@/domain/dashboard';
import { money } from '@/components/workspace/display';
import Link from '@/components/workspace/link';
import { categoryAppearance, weightLabel, type DashboardCategory } from './category-card';
import styles from './dashboard.module.css';

export function AllocationTreemap({
  categories,
  total,
  currency,
}: {
  categories: DashboardCategory[];
  total: number | null;
  currency: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const detailId = useId();
  const treeRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 300, height: 320 });
  useEffect(() => {
    const element = treeRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [categories.length]);
  const current = categories.find((item) => item.id === selected);
  const positive = categories
    .filter((item) => item.value !== null && item.value > 0)
    .sort((a, b) => b.value! - a.value!);
  const rects = allocationRects(positive.map((item) => ({ id: item.id, value: item.value! })));
  const partial =
    total === null || categories.some((item) => item.value === null || item.value < 0);
  const describe = (item: DashboardCategory) =>
    `${item.name} : ${money(item.value, currency)} · ${weightLabel(item.value, total)}`;
  return (
    <section
      className={`${styles.card} ${styles.allocation}`}
      aria-labelledby="allocation-heading"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setSelected(null);
      }}
    >
      <h2 id="allocation-heading">Répartition</h2>
      <p className={styles.muted}>
        {partial ? 'Répartition partielle · valeurs positives connues' : 'Poids dans le patrimoine'}
      </p>
      {rects.length ? (
        <div className={styles.treemap} role="group" aria-label="Répartition par catégories">
          {rects.map((rect) => {
            const item = positive.find((item) => item.id === rect.id)!;
            const { color, soft, Icon } = categoryAppearance(item.key);
            return (
              <button
                type="button"
                key={rect.id}
                className={styles.tile}
                style={{
                  left: `${(rect.x / size.width) * 100}%`,
                  top: `${(rect.y / size.height) * 100}%`,
                  width: `${(rect.width / size.width) * 100}%`,
                  height: `${(rect.height / size.height) * 100}%`,
                  background: soft,
                }}
                aria-label={describe(item)}
                aria-describedby={selected === item.id ? detailId : undefined}
                aria-pressed={selected === item.id}
                onFocus={() => setSelected(item.id)}
                onMouseEnter={() => setSelected(item.id)}
                onClick={() => setSelected(item.id)}
              >
                <span className={styles.tileContent}>
                  <Icon size={25} color={color} aria-hidden="true" />
                  <span>{item.name}</span>
                  <strong>{money(item.value, currency)}</strong>
                  <span>{weightLabel(item.value, total).replace(' du patrimoine', '')}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.allocationEmpty}>Aucune valeur positive à représenter.</div>
      )}
      {current && (
        <div
          id={detailId}
          data-testid="allocation-details"
          className={styles.allocationDetail}
          role="status"
        >
          <button type="button" aria-label="Effacer la sélection" onClick={() => setSelected(null)}>
            <X size={16} />
          </button>
          <strong>{current.name}</strong>
          <p>
            {money(current.value, currency)} · {weightLabel(current.value, total)}
          </p>
          <Link href={current.href}>
            Voir {current.key === 'CASH' ? 'le portefeuille' : 'la catégorie'} →
          </Link>
        </div>
      )}
      <details className={styles.allocationList}>
        <summary>
          Toutes les catégories <span className="sr-only">et les détails de la répartition</span>
        </summary>
        <ul aria-label="Poids des catégories">
          {categories.map((item) => (
            <li key={item.id}>
              <Link href={item.href}>
                <span>{item.name}</span>
                <span>
                  {money(item.value, currency)}
                  <small>{weightLabel(item.value, total)}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
      {partial && (
        <p className={styles.notice}>
          Les valeurs inconnues ou négatives ne sont pas représentées en surface. Les surfaces sont
          relatives aux seules valeurs positives ; les poids restent rapportés au patrimoine
          lorsqu’il est connu.
        </p>
      )}
    </section>
  );
}
