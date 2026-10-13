import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { kv, keys } from "../store";
import { ProjectSchema, ContractTerms } from "../types";
import { searchIssues, jiraDiagnose } from "../jira";
import { findChannel, listContractFiles, readFileText } from "../slack";
import { velocity } from "../analysis";
import { feriadosEntre, todayAR, workdaysBetween } from "../workdays";
import { ok, safe, getProject } from "./common";

const proyecto = z.string().describe("Slug del proyecto, ej: mega");

/** Tools solo para el TM: configuración y datos comerciales del contrato. */
export function registerTmTools(server: McpServer) {
  server.registerTool(
    "jira_check",
    {
      title: "Diagnóstico de Jira",
      description: "Muestra a qué Jira apunta el MCP, con qué usuario, y si ve el proyecto y sus cards.",
      inputSchema: { jiraKey: z.string().default("AM") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ jiraKey }) => ok(await jiraDiagnose(jiraKey))),
  );

  server.registerTool(
    "configure_project",
    {
      title: "Configurar proyecto",
      description: "Crea o actualiza un proyecto: clave de Jira, canal de Slack del contrato y equipo (con accountId de Jira para asignar).",
      inputSchema: ProjectSchema.shape,
    },
    safe(async (p) => {
      const parsed = ProjectSchema.parse(p);
      parsed.slug = parsed.slug.toLowerCase();
      await kv.hset(keys.projects, parsed.slug, parsed);
      return ok({ guardado: parsed });
    }),
  );

  server.registerTool(
    "find_contract_files",
    {
      title: "Buscar contrato en Slack",
      description:
        "Busca en el canal de Slack del proyecto (o en canales cuyo nombre contenga el proyecto) los PDFs/Excel compartidos, priorizando los que parecen contratos o propuestas.",
      inputSchema: { proyecto, canal: z.string().optional().describe("Nombre del canal si no está configurado") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ proyecto, canal }) => {
      const p = await getProject(proyecto).catch(() => null);
      const hint = canal ?? p?.slackChannel ?? proyecto;
      const canales = await findChannel(hint);
      if (!canales.length) throw new Error(`No encontré canales que contengan "${hint}" (¿el bot está invitado?).`);
      const out = [];
      for (const c of canales.slice(0, 5)) out.push({ canal: c.name, canalId: c.id, archivos: (await listContractFiles(c.id)).slice(0, 15) });
      return ok(out);
    }),
  );

  server.registerTool(
    "read_contract_file",
    {
      title: "Leer archivo de contrato",
      description:
        "Descarga un archivo (PDF/Excel/CSV) de Slack y devuelve su texto. Después extraé fechas, horas, montos e hitos, confirmalos con el TM y guardalos con save_contract_terms.",
      inputSchema: { canalId: z.string(), fileId: z.string() },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ canalId, fileId }) => {
      const f = (await listContractFiles(canalId)).find((x) => x.id === fileId);
      if (!f) throw new Error(`No encontré el archivo ${fileId} en el canal ${canalId}`);
      return ok({ archivo: { nombre: f.nombre, tipo: f.tipo, fecha: f.fecha, link: f.permalink }, texto: await readFileText(f) });
    }),
  );

  server.registerTool(
    "save_contract_terms",
    {
      title: "Guardar términos del contrato",
      description: "Guarda inicio, fin, horas, monto, alcance e hitos del contrato del proyecto (confirmados por el TM).",
      inputSchema: { proyecto, terminos: ContractTerms },
    },
    safe(async ({ proyecto, terminos }) => {
      const p = await getProject(proyecto);
      await kv.set(keys.contract(p.slug), terminos);
      return ok({ guardado: true, proyecto: p.slug, terminos });
    }),
  );

  server.registerTool(
    "contract_check",
    {
      title: "Chequeo de contrato",
      description:
        "Cruza el contrato guardado con Jira: días hábiles restantes (feriados AR), % de tiempo consumido vs. % de SP hechos, horas cargadas vs. contratadas, proyección de fin según velocidad y alertas.",
      inputSchema: { proyecto },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ proyecto }) => {
      const p = await getProject(proyecto);
      const c = await kv.get<ContractTerms>(keys.contract(p.slug));
      if (!c) throw new Error(`No hay contrato guardado para ${p.slug}. Usá find_contract_files → read_contract_file → save_contract_terms.`);
      const issues = await searchIssues(`project = ${p.jiraKey} ORDER BY created ASC`);
      const hoy = todayAR();

      const habTotal = workdaysBetween(c.inicio, c.fin);
      const habUsados = workdaysBetween(c.inicio, hoy < c.fin ? hoy : c.fin);
      const habRestantes = hoy < c.fin ? workdaysBetween(hoy, c.fin) : 0;
      const spTotal = issues.reduce((a, i) => a + (i.sp ?? 0), 0);
      const spHechos = issues.filter((i) => i.categoria === "done").reduce((a, i) => a + (i.sp ?? 0), 0);
      const horas = Math.round(issues.reduce((a, i) => a + i.horasCargadas, 0) * 10) / 10;
      const sinSP = issues.filter((i) => i.categoria !== "done" && i.sp == null).length;

      const pctTiempo = habTotal ? Math.round((habUsados / habTotal) * 100) : 0;
      const pctSP = spTotal ? Math.round((spHechos / spTotal) * 100) : 0;
      const pctHoras = c.horasContratadas ? Math.round((horas / c.horasContratadas) * 100) : null;

      // proyección: SP por día hábil desde el inicio
      const ritmo = habUsados > 0 ? spHechos / habUsados : 0;
      const spRestantes = spTotal - spHechos;
      const diasNecesarios = ritmo > 0 ? Math.ceil(spRestantes / ritmo) : null;
      const v = velocity(issues);

      const alertas: string[] = [];
      if (habRestantes === 0 && spRestantes > 0) alertas.push("El plazo del contrato venció con trabajo pendiente.");
      if (pctTiempo - pctSP >= 20) alertas.push(`Avance atrasado: pasó el ${pctTiempo}% del plazo y está hecho el ${pctSP}% de los SP.`);
      if (diasNecesarios != null && diasNecesarios > habRestantes)
        alertas.push(`Al ritmo actual faltan ~${diasNecesarios} días hábiles y quedan ${habRestantes}.`);
      if (ritmo === 0 && spRestantes > 0) alertas.push("Todavía no hay SP terminados: no se puede proyectar el fin.");
      if (pctHoras != null && pctHoras >= 80) alertas.push(`Horas: se consumió el ${pctHoras}% de las horas contratadas.`);
      if (sinSP > 0) alertas.push(`${sinSP} cards abiertas sin SP: la proyección subestima el trabajo restante.`);
      const proximos = c.hitos.filter((h) => h.fecha >= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha));
      const vencidos = c.hitos.filter((h) => h.fecha < hoy);

      return ok({
        proyecto: p.nombre,
        hoy,
        contrato: c,
        plazo: { diasHabilesTotales: habTotal, usados: habUsados, restantes: habRestantes, pctTiempo, feriadosRestantes: feriadosEntre(hoy, c.fin) },
        avance: { spTotal, spHechos, spRestantes, pctSP, cardsSinSP: sinSP, velocidadPromedioSprint: v.velocidadPromedioSP },
        horas: { cargadas: horas, contratadas: c.horasContratadas ?? null, pct: pctHoras, horasPorSP: v.horasPorSP },
        proyeccion: { spPorDiaHabil: Math.round(ritmo * 100) / 100, diasHabilesNecesarios: diasNecesarios },
        hitos: { proximos, pasados: vencidos },
        alertas,
      });
    }),
  );
}
