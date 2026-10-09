import styles from './dashboard.module.css';
const periods = [
  ['7d', '7 j'],
  ['30d', '30 j'],
  ['90d', '3 M'],
  ['1y', '1 A'],
  ['all', 'Tout'],
];
export function PeriodSelector({
  value,
  onChange,
  categories = false,
}: {
  value: string;
  onChange: (value: string) => void;
  categories?: boolean;
}) {
  return (
    <div
      className={styles.periods}
      role="group"
      aria-label={categories ? 'Période des courbes des catégories' : 'Période du graphique'}
    >
      {(categories ? periods.slice(0, 2) : periods).map(([key, label]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}
