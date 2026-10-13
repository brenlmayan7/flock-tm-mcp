import { Redis } from "@upstash/redis";

/**
 * Key-value mínimo. En Vercel usa Upstash Redis (Marketplace → Upstash → conectar al proyecto,
 * que crea KV_REST_API_URL y KV_REST_API_TOKEN). Sin esas variables usa memoria: sirve solo
 * para probar en local, porque se pierde al reiniciar.
 */
interface KV {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  hgetall<T>(key: string): Promise<Record<string, T>>;
  hset<T>(key: string, field: string, value: T): Promise<void>;
}

function makeRedis(): KV | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = new Redis({ url, token });
  return {
    get: (k) => r.get(k),
    set: async (k, v) => void (await r.set(k, v)),
    del: async (k) => void (await r.del(k)),
    hgetall: async <T,>(k: string) => ((await r.hgetall<Record<string, T>>(k)) ?? {}) as Record<string, T>,
    hset: async (k, f, v) => void (await r.hset(k, { [f]: v })),
  };
}

function makeMemory(): KV {
  const g = globalThis as unknown as { __kv?: Map<string, unknown> };
  const m = (g.__kv ??= new Map());
  return {
    get: async <T,>(k: string) => (m.has(k) ? (structuredClone(m.get(k)) as T) : null),
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    hgetall: async <T,>(k: string) => structuredClone((m.get(k) as Record<string, T>) ?? {}),
    hset: async (k, f, v) => {
      const h = (m.get(k) as Record<string, unknown>) ?? {};
      h[f] = structuredClone(v);
      m.set(k, h);
    },
  };
}

export const kv: KV = makeRedis() ?? makeMemory();
export const storageMode = makeRedis() ? "redis" : "memoria";

export const keys = {
  projects: "tm:projects",
  suggestions: (p: string) => `tm:sugg:${p}`,
  contract: (p: string) => `tm:contract:${p}`,
};

export const newId = () => Math.random().toString(36).slice(2, 10);
