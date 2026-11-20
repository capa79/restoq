import { db } from "./db";

// Lagrer en feil i feilloggen. Søkeparametre fjernes fra adressen, og tekstene kortes ned.
// Feillogging skal aldri selv gi feil for brukeren.
let lastCleanup = 0;
export async function logError(e: { source: "server" | "client"; message: string; stack?: string; path?: string; digest?: string; userAgent?: string; orgId?: number | null; userId?: number | null }) {
  try {
    const msg = (e.message || "").trim();
    if (!msg) return;
    const path = (e.path ?? "").split("?")[0].slice(0, 300);
    const p = await db();
    // Samme feil på samme side flere ganger i minuttet lagres bare én gang
    const dup = await p.query("SELECT 1 FROM error_log WHERE message = $1 AND path = $2 AND at > now() - interval '1 minute' LIMIT 1", [msg.slice(0, 1000), path]);
    if (dup.rowCount) return;
    await p.query(
      "INSERT INTO error_log (source, message, stack, path, digest, user_agent, org_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [e.source, msg.slice(0, 1000), (e.stack ?? "").slice(0, 6000), path, (e.digest ?? "").slice(0, 100), (e.userAgent ?? "").slice(0, 300), e.orgId ?? null, e.userId ?? null]
    );
    if (Date.now() - lastCleanup > 3_600_000) {
      lastCleanup = Date.now();
      await p.query("DELETE FROM error_log WHERE at < now() - interval '30 days'");
    }
  } catch (err) {
    console.error("Kunne ikke logge feil", err);
  }
}
