import type { ComponentProps, ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

export const dashboardCard = 'min-w-0 rounded-2xl border border-(--line) bg-(--surface)';

// The ! font utilities override the legacy, unlayered element resets only.
export const dashboardAction =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-(--line) bg-(--surface) px-3 py-2 text-xs! font-medium! transition-colors hover:bg-(--surface-secondary) disabled:cursor-wait disabled:opacity-60';

export const dashboardPrimaryAction = `${dashboardAction} border-(--accent)! bg-(--accent)! text-white! hover:bg-(--accent-hover)!`;

export function DashboardCard({ className = '', ...props }: ComponentProps<'section'>) {
  return <section className={`${dashboardCard} ${className}`} {...props} />;
}

export function DashboardKpi({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <DashboardCard aria-label={label} className="flex flex-col gap-2.5 p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-(--muted)">{label}</span>
        <span className="text-(--accent)" aria-hidden="true">
          {icon}
        </span>
      </div>
      <strong className="text-[clamp(1.35rem,2vw,1.75rem)] leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">
        {value}
      </strong>
      <span className="mt-auto text-xs text-(--muted)">{note}</span>
    </DashboardCard>
  );
}

export function PerformanceBadge({
  value,
  children,
}: {
  value: number | null;
  children: ReactNode;
}) {
  const Icon = value === null || value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${value === null || value === 0 ? 'bg-(--surface-secondary) text-(--muted)' : value > 0 ? 'bg-(--positive-soft) text-(--green)' : 'bg-(--negative-soft) text-(--red)'}`}
    >
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  );
}
