import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

const hash = (k: string) => createHash("sha256").update(k).digest("hex");

export async function createApiKey(orgId: number, name: string, by: number) {
  const key = "rq_" + randomBytes(24).toString("base64url");
  const p = await db();
  await p.query("INSERT INTO api_keys (org_id, name, prefix, key_hash, created_by) VALUES ($1, $2, $3, $4, $5)", [orgId, name.slice(0, 60) || "API-nøkkel", key.slice(0, 9), hash(key), by]);
  return key;
}

/** Kunden en API-nøkkel (Authorization: Bearer rq_…) hører til. */
export async function orgFromApiKey(req: Request): Promise<{ orgId: number; label: string } | null> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(rq_[A-Za-z0-9_-]{20,})$/.exec(h.trim());
  if (!m) return null;
  const p = await db();
  const r = (await p.query("UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 RETURNING org_id, name, prefix", [hash(m[1])])).rows[0];
  return r ? { orgId: Number(r.org_id), label: `API: ${r.name} (${r.prefix}…)` } : null;
}
