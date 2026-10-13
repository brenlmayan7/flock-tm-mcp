import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const msg = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

export function registerTeamPrompts(server: McpServer) {
  server.registerPrompt(
    "post-refinamiento",
    {
      title: "Cards después de un refinamiento",
      description: "Lee una reunión (Fathom) o notas y propone cards para revisar en el tablero.",
      argsSchema: {
        proyecto: z.string().describe("Slug del proyecto"),
        reunion: z.string().describe("Link o nombre de la reunión de Fathom, o las notas pegadas"),
      },
    },
    ({ proyecto, reunion }) =>
      msg(`Proyecto: ${proyecto}. Reunión de refinamiento: ${reunion}

1. Leé la reunión con el conector de Fathom (transcripción, no solo el resumen). Si son notas, usalas directo.
2. Llamá a list_projects para ver el equipo y a list_suggestions + jira_hygiene para no duplicar cards existentes.
3. Proponé cards con este formato (igual al tablero):
   - titulo con prefijo: "DEV - ", "UX/UI - ", "QA - ", "Spike - ", "Gestión - ", "Refinamiento - ", "Validación de propuesta - "
   - area (ux | dev | qa | gest), sp (Fibonacci 1-13), horas si se mencionaron, responsable (del equipo), labels
   - porque: qué se dijo y quién, con link al timestamp de Fathom (?timestamp=SEGUNDOS)
   - descripcion: contexto + "Criterios de aceptación:" en lista
   - Si algo es grande o incierto, proponé un Spike de 1-2 SP en vez de estimar a ciegas.
4. Mostrame la lista en una tabla corta y, cuando confirme, guardalas con save_suggestions (NO las crees en Jira: el equipo las aprueba desde el tablero).`),
  );

  server.registerPrompt(
    "status-semanal",
    {
      title: "Status semanal",
      description: "Arma un status del proyecto con Jira, Fathom y Slack.",
      argsSchema: { proyecto: z.string() },
    },
    ({ proyecto }) =>
      msg(`Armá el status semanal de ${proyecto}:
1. board_snapshot y sprint_velocity para el estado de Jira.
2. Reuniones de Fathom y mensajes de Slack de los últimos 7 días del proyecto: decisiones, pedidos del cliente, compromisos y bloqueos (con links).
3. Salida: Resumen (3 líneas) · Avance del sprint · Decisiones · Riesgos/warnings con prioridad y con quién levantarlos · Próximos pasos con responsable y fecha.`),
  );
}

export function registerTmPrompts(server: McpServer) {
  server.registerPrompt(
    "chequeo-contrato",
    {
      title: "Chequeo de contrato",
      description: "Busca el contrato en Slack, guarda los términos y los cruza con Jira.",
      argsSchema: { proyecto: z.string() },
    },
    ({ proyecto }) =>
      msg(`Chequeo de contrato de ${proyecto}:
1. Si contract_check dice que no hay contrato: find_contract_files → read_contract_file del más probable → extraé inicio, fin, horas, monto, alcance e hitos → mostrámelos y, cuando confirme, save_contract_terms.
2. Corré contract_check.
3. Devolveme: semáforo (verde/amarillo/rojo), alertas, qué llevar a comercial y si hay que re-estimar.`),
  );
}
