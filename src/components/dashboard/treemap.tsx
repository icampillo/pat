'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { allocationRects } from '@/domain/dashboard';
import { money } from '@/components/workspace/display';
import { weightLabel, type DashboardCategory } from './category-card';
import { categoryAppearance } from '@/components/ui/category-appearance';
import styles from './dashboard.module.css';

const TOOLTIP_WIDTH = 220;
const TOOLTIP_HEIGHT = 120;
const TOOLTIP_PADDING = 8;

export function AllocationTreemap({
  categories,
  total,
  currency,
}: {
  categories: DashboardCategory[];
  total: number | null;
  currency: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tooltipId = useId();
  const treeRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({
    width: 300,
    height: 320,
  });

  const positive = categories
    .filter((item) => item.value !== null && item.value > 0)
    .sort((a, b) => b.value! - a.value!);

  useEffect(() => {
    const element = treeRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) {
        setSize({ width, height });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [positive.length]);

  useEffect(() => {
    if (activeId === null) return;

    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !treeRef.current?.contains(event.target)) {
        setActiveId(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveId(null);
    };

    // Capture also sees outside interactions whose bubbling is stopped by another control.
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [activeId]);

  const rects = allocationRects(
    positive.map((item) => ({
      id: item.id,
      value: item.value!,
    })),
    0,
    0,
    size.width,
    size.height,
  );

  const partial =
    total === null || categories.some((item) => item.value === null || item.value < 0);

  const activeCategory = positive.find((item) => item.id === activeId);

  const activeRect = rects.find((rect) => rect.id === activeId);

  // Position du tooltip sans modifier le layout.
  const getTooltipPosition = () => {
    if (!activeRect) return { left: 0, top: 0 };

    const tooltipWidth = Math.min(TOOLTIP_WIDTH, size.width - TOOLTIP_PADDING * 2);

    const centerX = activeRect.x + activeRect.width / 2;
    const centerY = activeRect.y + activeRect.height / 2;

    // Bloquer le tooltip dans les limites horizontales.
    const left = Math.max(
      TOOLTIP_PADDING,
      Math.min(centerX - tooltipWidth / 2, size.width - tooltipWidth - TOOLTIP_PADDING),
    );

    // Le placer au-dessus ou en dessous du rectangle.
    const preferredTop = centerY > size.height / 2 ? centerY - TOOLTIP_HEIGHT - 12 : centerY + 12;

    const top = Math.max(
      TOOLTIP_PADDING,
      Math.min(preferredTop, size.height - TOOLTIP_HEIGHT - TOOLTIP_PADDING),
    );

    return { left, top };
  };

  const tooltipPosition = getTooltipPosition();

  const describe = (item: DashboardCategory) =>
    `${item.name} : ${money(item.value, currency)} · ${weightLabel(item.value, total)}`;

  return (
    <section className={`${styles.card} ${styles.allocation}`} aria-labelledby="allocation-heading">
      <h2 id="allocation-heading">Répartition</h2>

      <p className={styles.muted}>
        {partial ? 'Répartition partielle · valeurs positives connues' : 'Poids dans le patrimoine'}
      </p>

      {rects.length ? (
        <div
          ref={treeRef}
          className={styles.treemap}
          role="group"
          aria-label="Répartition par catégories"
        >
          {rects.map((rect) => {
            const item = positive.find((item) => item.id === rect.id)!;

            const { color, soft, Icon } = categoryAppearance(item.key);

            const isActive = activeId === item.id;

            return (
              <button
                type="button"
                key={rect.id}
                className={styles.tile}
                data-active={isActive}
                style={
                  {
                    left: `${(rect.x / size.width) * 100}%`,
                    top: `${(rect.y / size.height) * 100}%`,
                    width: `${(rect.width / size.width) * 100}%`,
                    height: `${(rect.height / size.height) * 100}%`,
                    background: soft,
                    '--tile-accent': color,
                  } as CSSProperties
                }
                aria-label={describe(item)}
                aria-describedby={isActive ? tooltipId : undefined}
                onPointerEnter={(event) => {
                  if (event.pointerType !== 'touch') {
                    setActiveId(item.id);
                  }
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType !== 'touch') {
                    setActiveId(null);
                  }
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === 'touch') {
                    setActiveId(item.id);
                  }
                }}
                onClick={() => setActiveId(item.id)}
                onFocus={() => setActiveId(item.id)}
                onBlur={() => {
                  // A touch on another tile opens it before the previous tile loses focus.
                  setActiveId((current) => (current === item.id ? null : current));
                }}
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

          {activeCategory && activeRect && (
            <div
              id={tooltipId}
              role="tooltip"
              className={styles.tileTooltip}
              style={
                {
                  left: tooltipPosition.left,
                  top: tooltipPosition.top,
                  '--tooltip-accent': categoryAppearance(activeCategory.key).color,
                } as CSSProperties
              }
            >
              <div className={styles.tileTooltipHeader}>
                {(() => {
                  const { Icon } = categoryAppearance(activeCategory.key);

                  return <Icon size={17} aria-hidden="true" />;
                })()}

                <span>{activeCategory.name}</span>
              </div>

              <strong className={styles.tileTooltipValue}>
                {money(activeCategory.value, currency)}
              </strong>

              <div className={styles.tileTooltipWeight}>
                <span>Poids du patrimoine</span>

                <strong>
                  {weightLabel(activeCategory.value, total).replace(' du patrimoine', '')}
                </strong>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.allocationEmpty}>Aucune valeur positive à représenter.</div>
      )}

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
