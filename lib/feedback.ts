// Tilbakemeldinger fra testerne og arbeidsflyten på utviklersiden.
export const FEEDBACK_KINDS = [
  { id: "feil", label: "Noe virker ikke" },
  { id: "tall", label: "Feil tall eller forslag" },
  { id: "forslag", label: "Forslag til forbedring" },
  { id: "ros", label: "Noe som fungerer bra" },
  { id: "annet", label: "Annet" },
] as const;
export const FEEDBACK_STATUSES = [
  { id: "ny", label: "Ny" },
  { id: "vurderes", label: "Vurderes" },
  { id: "planlagt", label: "Planlagt" },
  { id: "under_arbeid", label: "Under arbeid" },
  { id: "ferdig", label: "Ferdig" },
  { id: "avvist", label: "Ikke aktuelt" },
] as const;
export const FEEDBACK_PRIORITIES = [
  { id: "", label: "Ikke satt" },
  { id: "hoy", label: "Høy" },
  { id: "middels", label: "Middels" },
  { id: "lav", label: "Lav" },
] as const;
export const OPEN_STATUSES = ["ny", "vurderes", "planlagt", "under_arbeid"];
export const kindLabel = (id: string) => FEEDBACK_KINDS.find((k) => k.id === id)?.label ?? id;
export const statusLabel = (id: string) => FEEDBACK_STATUSES.find((s) => s.id === id)?.label ?? id;
export const priorityLabel = (id: string) => FEEDBACK_PRIORITIES.find((s) => s.id === id)?.label ?? "Ikke satt";

export function browser(ua: string) {
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Annet";
  const b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [b, os].filter(Boolean).join(" · ");
}

/** Godtar bare ekte PNG, JPEG og WebP (sjekker filsignaturen). */
export function imageType(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
