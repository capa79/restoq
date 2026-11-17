import { getDoc, type Invoice } from "@/lib/invoices";
import { v1auth, v1json } from "@/lib/v1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await v1auth(req);
  if (k instanceof Response) return k;
  const inv = await getDoc<Invoice>(k.orgId, "invoices", (await ctx.params).id);
  if (!inv) return v1json({ error: "not_found" }, 404);
  return v1json(inv);
}
