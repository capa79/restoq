import { apiUser, ID_RE, json } from "@/lib/api-auth";
import { readFile } from "@/lib/files";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser(req);
  if (u instanceof Response) return u;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: "Ugyldig." }, 400);
  const f = await readFile(u.org_id!, id);
  if (!f) return json({ error: "Fant ikke filen." }, 404);
  return new Response(new Uint8Array(f.data), {
    headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" },
  });
}
