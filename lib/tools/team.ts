import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { kv, keys, newId } from "../store";
import { SuggestionInput, type Suggestion, type Project, type ContractTerms } from "../types";
import { createIssue, searchIssues } from "../jira";
import { hygiene, velocity } from "../analysis";
import { todayAR, workdaysBetween } from "../workdays";
import { ok, safe, getProject } from "./common";

const proyecto = z.string().describe("Slug del proyecto, ej: mega");

/** Tools que puede usar todo el equipo. Nada de montos ni datos comerciales. */
export function registerTeamTools(server: McpServer) {
  server.registerTool(
    "list_projects",
    { title: "Listar proyectos", description: "Proyectos configurados por el TM, con su clave de Jira y equipo.", annotations: { readOnlyHint: true } },
    safe(async () => ok(Object.values(await kv.hgetall<Project>(keys.projects)))),
  );

  server.registerTool(
    "save_suggestions",
    {
      title: "Guardar cards sugeridas",
      description:
        "Guarda cards sugeridas (por ejemplo, después de un refinamiento) como PENDIENTES de revisión en el tablero. NO las crea en Jira. " +
        "Formato de título con prefijo: 'DEV - ', 'UX/UI - ', 'QA - ', 'Spike - ', 'Gestión - '. La descripción incluye criterios de aceptación.",
      inputSchema: { proyecto, cards: z.array(SuggestionInput).min(1), creadaPor: z.string().optional() },
    },
    safe(async ({ proyecto, cards, creadaPor }) => {
      const p = await getProject(proyecto);
      const ids: string[] = [];
      for (const c of cards) {
        const s: Suggestion = { ...c, id: newId(), proyecto: p.slug, estado: "pendiente", creadaPor, creadaEl: new Date().toISOString() };
        await kv.hset(keys.suggestions(p.slug), s.id, s);
        ids.push(s.id);
      }
      return ok({ guardadas: ids.length, ids, siguiente: "El equipo las revisa en el tablero y las aprueba con approve_suggestion." });
    }),
  );

  server.registerTool(
    "list_suggestions",
    {
      title: "Listar cards sugeridas",
      description: "Lista las cards sugeridas de un proyecto, filtrables por estado y área.",
      inputSchema: {
        proyecto,
        estado: z.enum(["pendiente", "aprobada", "descartada", "todas"]).default("pendiente"),
        area: z.enum(["ux", "dev", "qa", "gest"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ proyecto, estado, area }) => {
      const p = await getProject(proyecto);
      const all = Object.values(await kv.hgetall<Suggestion>(keys.suggestions(p.slug)));
      return ok(
        all
          .filter((s) => (estado === "todas" || s.estado === estado) && (!area || s.area === area))
          .sort((a, b) => a.creadaEl.localeCompare(b.creadaEl)),
      );
    }),
  );

  server.registerTool(
    "update_suggestion",
    {
      title: "Editar card sugerida",
      description: "Edita campos de una card sugerida pendiente (título, SP, responsable, sprint, descripción...).",
      inputSchema: { proyecto, id: z.string(), cambios: SuggestionInput.partial() },
    },
    safe(async ({ proyecto, id, cambios }) => {
      const p = await getProject(proyecto);
      const s = (await kv.hgetall<Suggestion>(keys.suggestions(p.slug)))[id];
      if (!s) throw new Error(`No existe la sugerencia ${id}`);
      if (s.estado !== "pendiente") throw new Error(`La sugerencia ya está ${s.estado}`);
      const n: Suggestion = { ...s, ...cambios, actualizadaEl: new Date().toISOString() };
      await kv.hset(keys.suggestions(p.slug), id, n);
      return ok(n);
    }),
  );

  server.registerTool(
    "approve_suggestion",
    {
      title: "Aprobar y crear en Jira",
      description: "Crea en Jira la card sugerida (con SP, labels, responsable, sprint y fecha) y la marca como aprobada.",
      inputSchema: { proyecto, id: z.string(), aprobadaPor: z.string().optional() },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    safe(async ({ proyecto, id, aprobadaPor }) => {
      const p = await getProject(proyecto);
      const s = (await kv.hgetall<Suggestion>(keys.suggestions(p.slug)))[id];
      if (!s) throw new Error(`No existe la sugerencia ${id}`);
      if (s.estado === "aprobada") return ok({ yaCreada: true, key: s.jiraKey, url: s.jiraUrl });
      const persona = s.responsable
        ? p.equipo.find((e) => e.nombre.toLowerCase().includes(s.responsable!.toLowerCase()))
        : undefined;
      const desc = [s.descripcion, "", "----", `_Por qué:_ ${s.porque}`, s.fuente && `_Fuente:_ ${s.fuente}`, aprobadaPor && `_Aprobada por:_ ${aprobadaPor}`]
        .filter((x) => typeof x === "string")
        .join("\n");
      const r = await createIssue({
        projectKey: p.jiraKey,
        resumen: s.titulo,
        descripcion: desc,
        labels: [...s.labels, "sugerida-ia"],
        sp: s.sp,
        horas: s.horas,
        assigneeId: persona?.jiraAccountId,
        sprintId: s.sprintId,
        vence: s.vence,
      });
      const n: Suggestion = { ...s, estado: "aprobada", jiraKey: r.key, jiraUrl: r.url, actualizadaEl: new Date().toISOString() };
      await kv.hset(keys.suggestions(p.slug), id, n);
      const avisos = [
        ...(s.responsable && !persona?.jiraAccountId ? [`No encontré el accountId de "${s.responsable}": quedó sin asignar.`] : []),
        ...(r.omitidos.length ? [`Jira no aceptó estos campos y la card se creó sin ellos: ${r.omitidos.join(", ")}`] : []),
      ];
      return ok({ creada: { key: r.key, url: r.url }, avisos });
    }),
  );

  server.registerTool(
    "dismiss_suggestion",
    {
      title: "Descartar card sugerida",
      description: "Descarta una card sugerida (no se crea en Jira).",
      inputSchema: { proyecto, id: z.string(), motivo: z.string().optional() },
    },
    safe(async ({ proyecto, id, motivo }) => {
      const p = await getProject(proyecto);
      const s = (await kv.hgetall<Suggestion>(keys.suggestions(p.slug)))[id];
      if (!s) throw new Error(`No existe la sugerencia ${id}`);
      await kv.hset(keys.suggestions(p.slug), id, { ...s, estado: "descartada", porque: motivo ? `${s.porque}\n[Descartada: ${motivo}]` : s.porque, actualizadaEl: new Date().toISOString() });
      return ok({ descartada: id });
    }),
  );

  server.registerTool(
    "jira_hygiene",
    {
      title: "Chequeo de higiene de Jira",
      description: "Detecta cards abiertas sin SP, sin responsable, vencidas, en curso sin horas cargadas y áreas (UX/DEV/QA) sin cards.",
      inputSchema: { proyecto },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ proyecto }) => {
      const p = await getProject(proyecto);
      return ok(hygiene(await searchIssues(`project = ${p.jiraKey} ORDER BY created ASC`)));
    }),
  );

  server.registerTool(
    "sprint_velocity",
    {
      title: "Velocidad por sprint",
      description: "SP comprometidos vs. hechos por sprint, velocidad promedio y horas por SP (base para re-estimar).",
      inputSchema: { proyecto },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ proyecto }) => {
      const p = await getProject(proyecto);
      return ok(velocity(await searchIssues(`project = ${p.jiraKey} AND sprint is not EMPTY ORDER BY created ASC`)));
    }),
  );

  server.registerTool(
    "board_snapshot",
    {
      title: "Datos para el tablero",
      description: "Todo lo que necesita el tablero del equipo en una llamada: sugerencias pendientes, higiene, velocidad y fechas del contrato (sin montos).",
      inputSchema: { proyecto },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ proyecto }) => {
      const p = await getProject(proyecto);
      const [sugs, issues, contrato] = await Promise.all([
        kv.hgetall<Suggestion>(keys.suggestions(p.slug)),
        searchIssues(`project = ${p.jiraKey} ORDER BY created ASC`).catch((e) => e as Error),
        kv.get<ContractTerms>(keys.contract(p.slug)),
      ]);
      const hoy = todayAR();
      return ok({
        proyecto: { slug: p.slug, nombre: p.nombre, jiraKey: p.jiraKey, equipo: p.equipo.map((e) => ({ nombre: e.nombre, rol: e.rol })) },
        fecha: hoy,
        sugerencias: Object.values(sugs).sort((a, b) => a.creadaEl.localeCompare(b.creadaEl)),
        jira: issues instanceof Error ? { error: issues.message } : {
          higiene: hygiene(issues),
          velocidad: velocity(issues),
          // cards para el tablero: abiertas + terminadas del sprint activo
          cards: issues
            .filter((i) => i.categoria !== "done" || i.sprints.some((s) => s.estado === "active"))
            .slice(-200)
            .map((i) => ({
              key: i.key, url: i.url, resumen: i.resumen, estado: i.estado, categoria: i.categoria,
              responsable: i.responsable, sp: i.sp, vence: i.vence,
              sprint: i.sprints.length ? i.sprints[i.sprints.length - 1].nombre : null,
              sprintActivo: i.sprints.some((s) => s.estado === "active"),
            })),
        },
        plazo: contrato
          ? { inicio: contrato.inicio, fin: contrato.fin, diasHabilesRestantes: contrato.fin > hoy ? workdaysBetween(hoy, contrato.fin) : 0, hitos: contrato.hitos }
          : null,
      });
    }),
  );
}
