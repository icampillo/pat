// Fixed accounting timezone, independent of browser and portfolio settings.
export const SNAPSHOT_TIMEZONE = 'Europe/Paris';
export function snapshotDay(at: Date | string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: SNAPSHOT_TIMEZONE }).format(new Date(at));
}

// A null separator marks a missing day; no value is synthesized or carried forward.
export function snapshotChartPoints(points: { date: string; value: number | null }[]) {
  return points.flatMap((point, index) => {
    const previous = points[index - 1];
    return previous &&
      Date.parse(snapshotDay(point.date)) - Date.parse(snapshotDay(previous.date)) > 86400000
      ? [{ date: new Date(Date.parse(previous.date) + 86400000).toISOString(), value: null }, point]
      : [point];
  });
}
