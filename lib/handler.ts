import { createMcpHandler } from "mcp-handler";
import { registerTeamTools } from "./tools/team";
import { registerTmTools } from "./tools/tm";
import { registerTeamPrompts, registerTmPrompts } from "./prompts";

export type Role = "tm" | "team";

/**
 * Arma el endpoint MCP para un rol.
 *  - /tm/mcp   → tools del equipo + contrato y configuración (solo vos)
 *  - /team/mcp → tools del equipo (sugerencias, aprobar en Jira, higiene, velocidad)
 * Acceso: clave en ?key=..., header x-api-key o Authorization: Bearer.
 */
export function makeRoute(role: Role, keyInPath = false) {
  const expected = role === "tm" ? process.env.TM_KEY : process.env.TEAM_KEY;
  // Con keyInPath la URL es /k/<KEY>/tm/mcp: sirve para clientes que borran el ?key= de la URL.
  const basePath = keyInPath ? `/k/${expected}/${role}` : `/${role}`;
  const handler = createMcpHandler(
    (server) => {
      registerTeamTools(server);
      registerTeamPrompts(server);
      if (role === "tm") {
        registerTmTools(server);
        registerTmPrompts(server);
      }
    },
    { serverInfo: { name: role === "tm" ? "flock-tm" : "flock-team", version: "0.1.0" } },
    { basePath, maxDuration: 60, disableSse: true, verboseLogs: process.env.NODE_ENV !== "production" },
  );

  return async (req: Request) => {
    if (!expected) return new Response(`Falta configurar ${role === "tm" ? "TM_KEY" : "TEAM_KEY"}`, { status: 500 });
    const url = new URL(req.url);
    if (keyInPath) {
      if (!url.pathname.startsWith(basePath + "/")) return new Response("No autorizado", { status: 401 });
      return handler(req);
    }
    const given =
      url.searchParams.get("key") ??
      req.headers.get("x-api-key") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (given !== expected) return new Response("No autorizado", { status: 401 });
    return handler(req);
  };
}
