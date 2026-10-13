/** Cliente mínimo de Jira Cloud con API token (https://id.atlassian.com/manage-profile/security/api-tokens). */

const env = () => {
  const base = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) throw new Error("Faltan JIRA_BASE_URL, JIRA_EMAIL o JIRA_API_TOKEN");
  return {
    base,
    auth: "Basic " + Buffer.from(`${email}:${token}`).toString("base64"),
    spField: process.env.JIRA_SP_FIELD || "customfield_10016",
    sprintField: process.env.JIRA_SPRINT_FIELD || "customfield_10020",
    issueType: process.env.JIRA_ISSUE_TYPE || "Historia",
  };
};

async function jira<T>(path: string, init: RequestInit = {}): Promise<T> {
  const e = env();
  const res = await fetch(e.base + path, {
    ...init,
    headers: { Authorization: e.auth, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type JiraIssue = {
  key: string;
  url: string;
  resumen: string;
  estado: string;
  categoria: string; // new | indeterminate | done
  realizada: boolean; // done o en QA en adelante (QA, UAT, pendiente de deploy, prod)
  responsable: string | null;
  sp: number | null;
  horasCargadas: number; // timespent en horas
  horasEstimadas: number | null;
  sprints: { id: number; nombre: string; estado: string; inicio?: string; fin?: string }[];
  vence: string | null;
  labels: string[];
};

/** Estados de QA en adelante: cuentan como realizados para "realizados vs. planificados". */
const QA_O_MAS = /(^|[^a-z])(qa|test|testing|uat|prueba|ready for (prod|release|deploy)|deploy|staging|producci[oó]n|prod|release)/i;

type RawIssue = { key: string; fields: Record<string, any> };

export async function searchIssues(jql: string, max = 1000): Promise<JiraIssue[]> {
  const e = env();
  const fields = ["summary", "status", "assignee", "labels", "duedate", "timespent", "timeoriginalestimate", e.spField, e.sprintField];
  const out: JiraIssue[] = [];
  let next: string | undefined;
  do {
    const q = new URLSearchParams({ jql, maxResults: "100", fields: fields.join(",") });
    if (next) q.set("nextPageToken", next);
    const r = await jira<{ issues: RawIssue[]; nextPageToken?: string }>(`/rest/api/3/search/jql?${q}`);
    for (const i of r.issues) {
      const f = i.fields;
      out.push({
        key: i.key,
        url: `${e.base}/browse/${i.key}`,
        resumen: f.summary,
        estado: f.status?.name ?? "—",
        categoria: /^(listo|done|hecho|cerrad[oa]|finalizad[oa]|resuelt[oa]|terminad[oa])$/i.test((f.status?.name ?? "").trim()) ? "done" : (f.status?.statusCategory?.key ?? "new"),
        realizada: QA_O_MAS.test(f.status?.name ?? "") || /^(listo|done|hecho|cerrad[oa]|finalizad[oa]|resuelt[oa]|terminad[oa])$/i.test((f.status?.name ?? "").trim()) || f.status?.statusCategory?.key === "done",
        responsable: f.assignee?.displayName ?? null,
        sp: typeof f[e.spField] === "number" ? f[e.spField] : null,
        horasCargadas: Math.round(((f.timespent ?? 0) / 3600) * 10) / 10,
        horasEstimadas: f.timeoriginalestimate ? Math.round((f.timeoriginalestimate / 3600) * 10) / 10 : null,
        // ordenados por fecha de inicio: el último es el sprint donde terminó la card (los futuros/sin fecha van al final)
        sprints: (f[e.sprintField] ?? [])
          .map((s: any) => ({ id: s.id, nombre: s.name, estado: s.state, inicio: s.startDate, fin: s.endDate }))
          .sort((x: any, y: any) => (x.inicio ?? "9999").localeCompare(y.inicio ?? "9999")),
        vence: f.duedate ?? null,
        labels: f.labels ?? [],
      });
    }
    next = r.nextPageToken;
  } while (next && out.length < max);
  return out;
}

export async function createIssue(p: {
  projectKey: string;
  resumen: string;
  descripcion: string;
  labels?: string[];
  sp?: number;
  horas?: number;
  assigneeId?: string;
  sprintId?: string;
  vence?: string;
}): Promise<{ key: string; url: string; omitidos: string[] }> {
  const e = env();
  const fields: Record<string, unknown> = {
    project: { key: p.projectKey },
    summary: p.resumen,
    issuetype: { name: e.issueType },
    // API v2 acepta descripción como texto (wiki markup); evita armar ADF a mano.
    description: p.descripcion,
    labels: (p.labels ?? []).map((l) => l.replace(/\s+/g, "-")),
  };
  if (p.sp != null) fields[e.spField] = p.sp;
  if (p.horas != null) fields.timetracking = { originalEstimate: `${p.horas}h` };
  if (p.assigneeId) fields.assignee = { accountId: p.assigneeId };
  if (p.sprintId) fields[e.sprintField] = Number(p.sprintId);
  if (p.vence) fields.duedate = p.vence;
  // Si algún campo opcional no está en la pantalla de creación de Jira, reintenta sin él y avisa.
  const optional = new Set(["timetracking", "assignee", "duedate", "labels", e.spField, e.sprintField]);
  const omitidos: string[] = [];
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await jira<{ key: string }>(`/rest/api/2/issue`, { method: "POST", body: JSON.stringify({ fields }) });
      return { key: r.key, url: `${e.base}/browse/${r.key}`, omitidos };
    } catch (err) {
      const m = String((err as Error).message);
      const bad = [...optional].filter((f) => f in fields && m.includes(`"${f}"`));
      if (!m.startsWith("Jira 400") || !bad.length) throw err;
      for (const f of bad) {
        delete fields[f];
        omitidos.push(f);
      }
    }
  }
  throw new Error(`Jira rechazó la card incluso sin: ${omitidos.join(", ")}`);
}

export const jiraConfigured = () =>
  Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);

/** Diagnóstico: a qué Jira apunta, con qué usuario y si ve el proyecto. */
export async function jiraDiagnose(projectKey: string) {
  const e = env();
  const out: Record<string, unknown> = { jiraBaseUrl: e.base };
  try {
    const me = await jira<{ displayName: string; emailAddress?: string }>(`/rest/api/3/myself`);
    out.usuario = { nombre: me.displayName, email: me.emailAddress ?? "(oculto)" };
  } catch (err) { out.usuario = `ERROR: ${(err as Error).message}`; }
  try {
    const pr = await jira<{ key: string; name: string }>(`/rest/api/3/project/${projectKey}`);
    out.proyecto = `${pr.key} - ${pr.name}`;
  } catch (err) { out.proyecto = `ERROR: ${(err as Error).message}`; }
  try {
    const q = new URLSearchParams({ jql: `project = ${projectKey}`, maxResults: "1", fields: "summary" });
    const r = await jira<{ issues: unknown[] }>(`/rest/api/3/search/jql?${q}`);
    out.busquedaDevuelveCards = r.issues.length > 0;
  } catch (err) { out.busqueda = `ERROR: ${(err as Error).message}`; }
  return out;
}
