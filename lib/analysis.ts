import type { JiraIssue } from "./jira";
import { areaOf } from "./tools/common";
import { todayAR } from "./workdays";

export function hygiene(issues: JiraIssue[]) {
  const hoy = todayAR();
  const abiertas = issues.filter((i) => i.categoria !== "done");
  const enCurso = abiertas.filter((i) => i.categoria === "indeterminate");
  const enSprintActivo = abiertas.filter((i) => i.sprints.some((s) => s.estado === "active"));
  const ref = (i: JiraIssue) => ({ key: i.key, resumen: i.resumen, url: i.url, responsable: i.responsable, estado: i.estado });

  const porArea: Record<string, number> = { ux: 0, dev: 0, qa: 0, gest: 0, otro: 0 };
  for (const i of abiertas) porArea[areaOf(i.resumen)]++;

  const warnings = {
    sinSP: abiertas.filter((i) => i.sp == null).map(ref),
    sinResponsable: abiertas.filter((i) => !i.responsable).map(ref),
    vencidas: abiertas.filter((i) => i.vence && i.vence < hoy).map((i) => ({ ...ref(i), vence: i.vence })),
    enCursoSinHoras: enCurso.filter((i) => i.horasCargadas === 0).map(ref),
    sprintActivoSinSP: enSprintActivo.filter((i) => i.sp == null).map(ref),
  };
  const areasSinCards = (["ux", "dev", "qa"] as const).filter((a) => porArea[a] === 0);

  return {
    fecha: hoy,
    totales: { abiertas: abiertas.length, enCurso: enCurso.length, enSprintActivo: enSprintActivo.length },
    cardsAbiertasPorArea: porArea,
    areasSinCards,
    warnings,
    resumen: [
      warnings.sinSP.length && `${warnings.sinSP.length} cards abiertas sin story points`,
      warnings.sinResponsable.length && `${warnings.sinResponsable.length} sin responsable`,
      warnings.vencidas.length && `${warnings.vencidas.length} vencidas`,
      warnings.enCursoSinHoras.length && `${warnings.enCursoSinHoras.length} en curso sin horas cargadas`,
      areasSinCards.length && `No hay cards abiertas de: ${areasSinCards.join(", ")}`,
    ].filter(Boolean),
  };
}

export function velocity(issues: JiraIssue[]) {
  type Row = { id: number; nombre: string; estado: string; inicio?: string; fin?: string; spComprometidos: number; spHechos: number; horasCargadas: number; cards: number; cardsSinSP: number };
  const rows = new Map<number, Row>();
  for (const i of issues) {
    i.sprints.forEach((s, idx) => {
      const r =
        rows.get(s.id) ??
        { id: s.id, nombre: s.nombre, estado: s.estado, inicio: s.inicio?.slice(0, 10), fin: s.fin?.slice(0, 10), spComprometidos: 0, spHechos: 0, horasCargadas: 0, cards: 0, cardsSinSP: 0 };
      r.cards++;
      r.spComprometidos += i.sp ?? 0;
      if (i.sp == null) r.cardsSinSP++;
      const ultimo = idx === i.sprints.length - 1;
      if (ultimo) {
        // lo hecho y las horas cuentan para el último sprint de la card
        if (i.realizada) r.spHechos += i.sp ?? 0;
        r.horasCargadas += i.horasCargadas;
      }
      rows.set(s.id, r);
    });
  }
  const sprints = [...rows.values()].sort((a, b) => (a.inicio ?? "").localeCompare(b.inicio ?? ""));
  const cerrados = sprints.filter((s) => s.estado === "closed");
  const prom = cerrados.length ? cerrados.reduce((a, s) => a + s.spHechos, 0) / cerrados.length : null;
  const spHechos = issues.filter((i) => i.categoria === "done").reduce((a, i) => a + (i.sp ?? 0), 0);
  const horas = issues.filter((i) => i.categoria === "done").reduce((a, i) => a + i.horasCargadas, 0);
  return {
    sprints,
    velocidadPromedioSP: prom == null ? null : Math.round(prom * 10) / 10,
    horasPorSP: spHechos > 0 && horas > 0 ? Math.round((horas / spHechos) * 10) / 10 : null,
    nota:
      "SP comprometidos = SP de todas las cards que pasaron por el sprint (incluye arrastradas). SP hechos = cards en QA en adelante o finalizadas; y horas cuentan solo en el último sprint de cada card. horasPorSP sale de cards terminadas con horas cargadas.",
  };
}
