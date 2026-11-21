import { NextResponse } from "next/server";
import { getCurrentUser, sameOrigin, type CurrentUser } from "./session";

export const COLLECTIONS = ["waste", "orders", "counts", "config", "invoices", "slips", "adjust"] as const;
/** Samlinger appen kan skrive direkte i. Fakturaer og pakksedler endres via egne API-er (matching, godkjenning). Manuelle bestandsendringer (adjust) krever passord via /api/stock-adjust. */
export const CLIENT_WRITABLE = ["waste", "orders", "counts", "config"];
export type Col = (typeof COLLECTIONS)[number];
export const isCol = (c: string): c is Col => (COLLECTIONS as readonly string[]).includes(c);
export const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Innlogget bruker som jobber i en kunde. Endringer krever samme opphav. */
export async function apiUser(req: Request, write = false): Promise<CurrentUser | NextResponse> {
  if (write && !(await sameOrigin(req))) return json({ error: "Ugyldig opphav." }, 403);
  const u = await getCurrentUser();
  if (!u) return json({ error: "Du er logget ut. Logg inn på nytt." }, 401);
  if (u.must_change_password) return json({ error: "Velg eget passord først." }, 403);
  if (!u.org_id) return json({ error: "Ingen kunde er valgt." }, 400);
  return u;
}
export const canManage = (u: CurrentUser) => u.role === "owner" || u.role === "admin";
