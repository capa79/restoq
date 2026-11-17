import { apiUser, json } from "@/lib/api-auth";
import { MAX_FILE, saveFile } from "@/lib/files";

export async function POST(req: Request) {
  const u = await apiUser(req, true);
  if (u instanceof Response) return u;
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!f || typeof f === "string") return json({ error: "Ingen fil." }, 400);
  if (f.size > MAX_FILE) return json({ error: "Filen er større enn 10 MB." }, 413);
  try {
    return json(await saveFile(u.org_id!, f.name, f.type, Buffer.from(await f.arrayBuffer()), u.id));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Kunne ikke lagre filen." }, 400);
  }
}
