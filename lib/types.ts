import { z } from "zod";

/** Configuración de un proyecto (la carga el TM una vez). */
export const ProjectSchema = z.object({
  slug: z.string().describe("Identificador corto, ej: mega"),
  nombre: z.string().describe("Nombre visible, ej: MEGA (AAARBA)"),
  jiraKey: z.string().describe("Clave del proyecto en Jira, ej: AM"),
  slackChannel: z
    .string()
    .optional()
    .describe("Canal de Slack donde se comparte el contrato, ej: proy-aaarba-gestion"),
  equipo: z
    .array(z.object({ nombre: z.string(), jiraAccountId: z.string().optional(), rol: z.string().optional() }))
    .default([])
    .describe("Personas del equipo, para asignar cards"),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Card sugerida: mismo formato que las del tablero MEGA. */
export const AREAS = ["ux", "dev", "qa", "gest"] as const;
export const SuggestionInput = z.object({
  area: z.enum(AREAS).describe("ux | dev | qa | gest"),
  titulo: z
    .string()
    .describe("Con prefijo: 'DEV - ', 'UX/UI - ', 'QA - ', 'Spike - ', 'Gestión - ', 'Refinamiento - ', 'Validación de propuesta - '"),
  sp: z.number().min(0).max(21).optional().describe("Story points sugeridos"),
  horas: z.number().min(0).optional().describe("Horas estimadas (opcional)"),
  responsable: z.string().optional().describe("Nombre de la persona del equipo"),
  sprintId: z.string().optional().describe("Id del sprint en Jira (ej: 1393)"),
  vence: z.string().optional().describe("Fecha límite YYYY-MM-DD"),
  labels: z.array(z.string()).default([]),
  porque: z.string().describe("Por qué se sugiere (con link a Fathom/Slack si existe)"),
  descripcion: z.string().describe("Descripción + criterios de aceptación en markdown"),
  fuente: z.string().optional().describe("Link a la reunión o mensaje de origen"),
});
export type SuggestionInput = z.infer<typeof SuggestionInput>;

export type SuggestionStatus = "pendiente" | "aprobada" | "descartada";
export type Suggestion = SuggestionInput & {
  id: string;
  proyecto: string;
  estado: SuggestionStatus;
  creadaPor?: string;
  creadaEl: string;
  jiraKey?: string;
  jiraUrl?: string;
  actualizadaEl?: string;
};

/** Términos del contrato, extraídos por Claude del archivo de Slack y confirmados por el TM. */
export const ContractTerms = z.object({
  inicio: z.string().describe("YYYY-MM-DD"),
  fin: z.string().describe("YYYY-MM-DD"),
  horasContratadas: z.number().optional(),
  monto: z.number().optional(),
  moneda: z.string().optional(),
  alcance: z.string().optional().describe("Resumen del alcance pactado"),
  hitos: z.array(z.object({ fecha: z.string(), descripcion: z.string() })).default([]),
  fuente: z.string().optional().describe("Link al archivo en Slack"),
});
export type ContractTerms = z.infer<typeof ContractTerms>;
