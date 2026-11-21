// Planday Open API (https://openapi.planday.com).
// Restoq har én Planday-app (PLANDAY_CLIENT_ID). Kunden kobler appen til sin Planday-portal
// (Innstillinger → API-tilgang → Koble til app, med Restoqs app-ID) og limer inn tokenet (refresh token) i Restoq.
// Tilgangstoken hentes fra https://id.planday.com/connect/token (gyldig 1 time). Hvert kall sender X-ClientId + Bearer.
// Restoq skriver ikke til Planday. Kommer det skriving senere, må den kreve requirePassword() (lib/reauth.ts) før den sendes.
// Restoq leser bare: daglige omsetningsbudsjetter (GET /revenue/v1.0/budgets) og daglig omsetning (GET /revenue/v1.0/revenue).
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { putDoc } from "./invoices";

const API = process.env.PLANDAY_API_BASE || "https://openapi.planday.com";
const TOKEN_URL = process.env.PLANDAY_TOKEN_URL || "https://id.planday.com/connect/token";
export const plandayConfigured = () => Boolean(process.env.PLANDAY_CLIENT_ID && (process.env.SECRET_KEY ?? "").length >= 32);

export class PlandayError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

async function accessToken(refreshToken: string): Promise<{ access: string; refresh?: string }> {
  const body = new URLSearchParams({ client_id: process.env.PLANDAY_CLIENT_ID!, grant_type: "refresh_token", refresh_token: refreshToken });
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000) }).catch(() => {
    throw new PlandayError("Fikk ikke kontakt med Planday. Prøv igjen om litt.");
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
  if (!res.ok || !j.access_token) throw new PlandayError(res.status === 400 || res.status === 401 ? "Planday godtok ikke tokenet. Sjekk at Restoq-appen er koblet til i Planday og at hele tokenet er limt inn." : `Planday svarte ${res.status} ved innlogging.`, res.status);
  return { access: j.access_token, refresh: j.refresh_token };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(access: string, path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { "X-ClientId": process.env.PLANDAY_CLIENT_ID!, Authorization: `Bearer ${access}`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let j: any = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    if (res.status === 403) throw new PlandayError("Restoq mangler tilgang i Planday (omsetning/avdelinger). Gi appen tilgangene revenue:read og department:read.", 403);
    throw new PlandayError(`Planday: ${j?.title || j?.detail || j?.message || "HTTP " + res.status}`, res.status);
  }
  return j;
}

type Dept = { id: number; name: string };
type Info = { connectedAt: string; departments: Dept[]; departmentIds: number[]; lastSync?: string; lastError?: string };

async function load(orgId: number) {
  const p = await db();
  const r = (await p.query("SELECT secret, info FROM integrations WHERE org_id = $1 AND provider = 'planday'", [orgId])).rows[0];
  if (!r) throw new PlandayError("Planday er ikke koblet til. Leder kobler til under Innstillinger → Planday.");
  return { refresh: decrypt(r.secret), info: r.info as Info };
}

async function saveInfo(orgId: number, info: Info, refresh?: string) {
  const p = await db();
  if (refresh) await p.query("UPDATE integrations SET info = $2, secret = $3 WHERE org_id = $1 AND provider = 'planday'", [orgId, JSON.stringify(info), encrypt(refresh)]);
  else await p.query("UPDATE integrations SET info = $2 WHERE org_id = $1 AND provider = 'planday'", [orgId, JSON.stringify(info)]);
}

export async function connectPlanday(orgId: number, token: string) {
  if (!plandayConfigured()) throw new PlandayError("Planday-koblingen er ikke satt opp på serveren (PLANDAY_CLIENT_ID og SECRET_KEY).");
  const t = await accessToken(token.trim());
  const d = await call(t.access, "/hr/v1/departments");
  const departments: Dept[] = ((d?.data ?? []) as { id: number; name: string }[]).map((x) => ({ id: Number(x.id), name: String(x.name ?? x.id) }));
  const info: Info = { connectedAt: new Date().toISOString(), departments, departmentIds: departments.map((x) => x.id) };
  const p = await db();
  await p.query(
    `INSERT INTO integrations (org_id, provider, secret, info) VALUES ($1, 'planday', $2, $3)
     ON CONFLICT (org_id, provider) DO UPDATE SET secret = EXCLUDED.secret, info = EXCLUDED.info`,
    [orgId, encrypt(t.refresh || token.trim()), JSON.stringify(info)]
  );
  return info;
}

export async function plandayStatus(orgId: number) {
  const p = await db();
  const r = (await p.query("SELECT info FROM integrations WHERE org_id = $1 AND provider = 'planday'", [orgId])).rows[0];
  return { available: plandayConfigured(), connected: !!r, info: (r?.info as Info) ?? null, clientId: process.env.PLANDAY_CLIENT_ID ?? null };
}

export async function setPlandayDepartments(orgId: number, ids: number[]) {
  const { info } = await load(orgId);
  info.departmentIds = ids.filter((id) => info.departments.some((d) => d.id === id));
  await saveInfo(orgId, info);
  return info;
}

export async function disconnectPlanday(orgId: number) {
  const p = await db();
  await p.query("DELETE FROM integrations WHERE org_id = $1 AND provider = 'planday'", [orgId]);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Henter omsetningsplan (budsjett) og faktisk omsetning per dag og lagrer dem som config/planday. */
export async function syncPlanday(orgId: number, by: number | null, from?: string, to?: string) {
  const { refresh, info } = await load(orgId);
  const f = from || iso(new Date(Date.now() - 56 * 864e5));
  const t2 = to || iso(new Date(Date.now() + 42 * 864e5));
  const tok = await accessToken(refresh);
  const deps = new Set(info.departmentIds?.length ? info.departmentIds : info.departments.map((d) => d.id));
  const days: Record<string, { plan?: number; actual?: number }> = {};
  const add = (date: string, k: "plan" | "actual", v: unknown) => {
    const n = Number(v);
    if (!date || !Number.isFinite(n)) return;
    const d = date.slice(0, 10);
    days[d] = days[d] || {};
    days[d][k] = Math.round(((days[d][k] ?? 0) + n) * 100) / 100;
  };
  try {
    const q = new URLSearchParams({ from: f, to: t2 });
    [...deps].forEach((id) => q.append("departmentIds", String(id)));
    const b = await call(tok.access, `/revenue/v1.0/budgets?${q}`);
    for (const x of (b?.data ?? []) as { departmentId?: number; startDate: string; revenue?: number | null }[]) {
      if (x.departmentId != null && deps.size && !deps.has(Number(x.departmentId))) continue;
      if (x.revenue != null) add(x.startDate, "plan", x.revenue);
    }
    for (let offset = 0, guard = 0; guard < 200; guard++) {
      const r = await call(tok.access, `/revenue/v1.0/revenue?${new URLSearchParams({ from: f, to: t2, offset: String(offset), limit: "50" })}`);
      const rows = (r?.data ?? []) as { departmentId?: number; date: string; turnover?: number }[];
      for (const x of rows) {
        if (x.departmentId != null && deps.size && !deps.has(Number(x.departmentId))) continue;
        add(x.date, "actual", x.turnover);
      }
      offset += rows.length;
      if (!rows.length || offset >= Number(r?.paging?.total ?? 0)) break;
    }
  } catch (e) {
    info.lastError = e instanceof Error ? e.message : String(e);
    await saveInfo(orgId, info, tok.refresh);
    throw e;
  }
  const syncedAt = new Date().toISOString();
  await putDoc(orgId, "config", "planday", { from: f, to: t2, days, syncedAt }, by);
  info.lastSync = syncedAt;
  delete info.lastError;
  await saveInfo(orgId, info, tok.refresh);
  return { days: Object.keys(days).length, from: f, to: t2, syncedAt };
}
