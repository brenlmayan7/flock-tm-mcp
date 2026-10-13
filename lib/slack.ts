/**
 * Lee los archivos de contrato que se comparten en el canal de Slack del proyecto.
 * Bot token con scopes: channels:read, groups:read, files:read. El bot tiene que estar
 * invitado al canal (/invite @tu-bot).
 */
import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";

const token = () => {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("Falta SLACK_BOT_TOKEN");
  return t;
};

async function slack<T>(method: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const j = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!j.ok) throw new Error(`Slack ${method}: ${j.error}`);
  return j;
}

export async function findChannel(nameOrHint: string): Promise<{ id: string; name: string }[]> {
  const hint = nameOrHint.toLowerCase().replace(/^#/, "");
  const found: { id: string; name: string }[] = [];
  let cursor = "";
  do {
    const r = await slack<{ channels: { id: string; name: string }[]; response_metadata?: { next_cursor?: string } }>(
      "conversations.list",
      { types: "public_channel,private_channel", limit: "1000", exclude_archived: "true", ...(cursor ? { cursor } : {}) },
    );
    found.push(...r.channels.filter((c) => c.name === hint || c.name.includes(hint)));
    cursor = r.response_metadata?.next_cursor ?? "";
  } while (cursor);
  // coincidencia exacta primero
  return found.sort((a, b) => Number(b.name === hint) - Number(a.name === hint));
}

export type SlackFile = { id: string; nombre: string; tipo: string; fecha: string; url: string; permalink: string; usuario: string };

export async function listContractFiles(channelId: string): Promise<SlackFile[]> {
  const r = await slack<{ files: any[] }>("files.list", { channel: channelId, count: "100" });
  const re = /contrat|propuesta|sow|orden|cotiz|presupuesto|anexo|acuerdo/i;
  return r.files
    .filter((f) => ["pdf", "xlsx", "xls", "docx", "csv"].includes(f.filetype))
    .map((f) => ({
      id: f.id,
      nombre: f.name ?? f.title,
      tipo: f.filetype,
      fecha: new Date(f.created * 1000).toISOString().slice(0, 10),
      url: f.url_private_download ?? f.url_private,
      permalink: f.permalink,
      usuario: f.user,
    }))
    // primero los que parecen contratos, después el resto, más nuevos primero
    .sort((a, b) => Number(re.test(b.nombre)) - Number(re.test(a.nombre)) || b.fecha.localeCompare(a.fecha));
}

const MAX_CHARS = 40_000;

export async function readFileText(f: SlackFile): Promise<string> {
  const res = await fetch(f.url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`No pude descargar ${f.nombre}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());

  if (f.tipo === "pdf") {
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return (text as string).slice(0, MAX_CHARS);
  }
  if (f.tipo === "xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf.buffer as ArrayBuffer);
    const parts: string[] = [];
    wb.eachSheet((ws) => {
      parts.push(`## Hoja: ${ws.name}`);
      ws.eachRow((row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) => {
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          if (v && typeof v === "object" && "result" in (v as any)) return String((v as any).result);
          if (v && typeof v === "object" && "text" in (v as any)) return String((v as any).text);
          return v == null ? "" : String(v);
        });
        parts.push(vals.join(" | "));
      });
    });
    return parts.join("\n").slice(0, MAX_CHARS);
  }
  if (f.tipo === "csv") return new TextDecoder().decode(buf).slice(0, MAX_CHARS);
  return `(Formato ${f.tipo} no soportado todavía: abrilo desde ${f.permalink})`;
}
