import { appUrl } from "./mail";

/** Offentlig adresse for videresendinger. Bak Render er req.url intern (localhost), så vi bruker
 *  x-forwarded-host/-proto når de finnes, ellers APP_URL. Bare kjente vertsnavn godtas. */
export function publicOrigin(req: Request): string {
  const fallback = appUrl();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  if (!host || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return fallback;
  const allowed = [new URL(fallback).host, "restoq.no", "www.restoq.no"];
  if (!allowed.includes(host) && !host.endsWith(".onrender.com")) return fallback;
  return `${proto === "http" ? "http" : "https"}://${host}`;
}
