/**
 * Feriados nacionales de Argentina (inamovibles, trasladables ya movidos y días puente).
 * Revisalos contra el calendario oficial (argentina.gob.ar/interior/feriados) y sumá los de 2027.
 * Podés agregar extras con la variable FERIADOS_EXTRA="2026-12-24,2026-12-31".
 */
const FERIADOS = [
  // 2026
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-23", "2026-03-24", "2026-04-02", "2026-04-03",
  "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20", "2026-07-09", "2026-07-10", "2026-08-17",
  "2026-10-12", "2026-11-23", "2026-12-07", "2026-12-08", "2026-12-25",
];

const holidays = () =>
  new Set([...FERIADOS, ...(process.env.FERIADOS_EXTRA ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);

const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Días hábiles en [desde, hasta) — sin fines de semana ni feriados. */
export function workdaysBetween(desde: string, hasta: string): number {
  const h = holidays();
  let n = 0;
  for (let d = parse(desde); d < parse(hasta); d = new Date(d.getTime() + 864e5)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !h.has(iso(d))) n++;
  }
  return n;
}

/** Fecha de hoy en Buenos Aires, YYYY-MM-DD. */
export const todayAR = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

export const feriadosEntre = (desde: string, hasta: string) =>
  [...holidays()].filter((f) => f >= desde && f < hasta).sort();
