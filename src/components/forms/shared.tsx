'use client';
export type SaveAction = (
  path: string,
  method: string,
  data: unknown,
  version?: number,
) => Promise<{ id?: string }>;
export const nowLocal = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function Field({
  label,
  name,
  value = '',
  type = 'text',
  required = false,
  help,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        defaultValue={value}
        type={type}
        inputMode={
          ['quantity', 'acquisitionCost', 'meta.weightGrams', 'meta.purity'].includes(name)
            ? 'decimal'
            : undefined
        }
        required={required}
        step={type === 'number' ? 'any' : undefined}
      />
      {help && <small>{help}</small>}
    </label>
  );
}
