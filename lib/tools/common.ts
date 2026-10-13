import { kv, keys } from "../store";
import type { Project } from "../types";

export const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
export const fail = (msg: string) => ({ content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true });

/** Envuelve un handler para que cualquier excepción vuelva como error legible para Claude. */
export const safe =
  <A,>(fn: (a: A) => Promise<ReturnType<typeof ok>>) =>
  async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };

export async function getProject(slug: string): Promise<Project> {
  const all = await kv.hgetall<Project>(keys.projects);
  const p = all[slug.toLowerCase()];
  if (!p) {
    const disp = Object.keys(all);
    throw new Error(
      `No existe el proyecto "${slug}". ${disp.length ? `Disponibles: ${disp.join(", ")}` : "Todavía no hay proyectos: el TM tiene que correr configure_project."}`,
    );
  }
  return p;
}

/** Clasifica una card por el prefijo del título, igual que el tablero. */
export function areaOf(title: string): "ux" | "dev" | "qa" | "gest" | "otro" {
  if (/^\s*(UX\/UI|Refinamiento|Validaci[oó]n|Descubrimiento)/i.test(title)) return "ux";
  if (/^\s*(DEV|Spike)/i.test(title)) return "dev";
  if (/^\s*QA/i.test(title)) return "qa";
  if (/^\s*Gesti[oó]n/i.test(title)) return "gest";
  return "otro";
}
