const periods = [
  ['24h', '24h'],
  ['7d', '7j'],
  ['30d', '30j'],
  ['90d', '90j'],
  ['180d', '180j'],
  ['1y', '1y'],
  ['all', 'Tout'],
] as const;

export function PeriodSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="grid w-full grid-cols-7 gap-0.5 rounded-lg border border-(--line) bg-(--surface-secondary) p-1 sm:w-auto"
      role="group"
      aria-label="Période du graphique"
    >
      {periods.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`min-h-9 rounded-md px-1.5 text-xs! font-medium! transition-colors sm:px-2.5 ${value === key ? 'bg-(--surface) text-(--accent) shadow-xs' : 'text-(--muted) hover:bg-(--surface) hover:text-(--ink)'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
