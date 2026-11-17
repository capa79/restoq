import { NextResponse } from "next/server";
import { orgFromApiKey } from "./apikeys";
import { saveFile } from "./files";

export const v1json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function v1auth(req: Request) {
  const k = await orgFromApiKey(req);
  if (!k) return v1json({ error: "unauthorized", message: "Mangler eller ugyldig API-nøkkel (Authorization: Bearer rq_…)." }, 401);
  return k;
}
/** Valgfritt vedlegg i JSON: { file: { name, contentBase64 } } */
export async function attachFromBody(orgId: number, body: Record<string, unknown>) {
  const f = body.file as { name?: string; contentBase64?: string; mime?: string } | undefined;
  if (!f?.contentBase64) return null;
  const buf = Buffer.from(f.contentBase64, "base64");
  return (await saveFile(orgId, f.name ?? "dokument", f.mime ?? "", buf, null)).id;
}
