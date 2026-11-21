// Oversetter Restoq-tekster med Claude (valgfritt: krever ANTHROPIC_API_KEY i Render).
import { UI_LANGS, type UiLang } from "./i18n";

export const aiTranslateEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function aiTranslate(lang: UiLang, strings: string[]): Promise<Record<string, string>> {
  const target = UI_LANGS.find((l) => l.id === lang)?.mt ?? lang;
  const out: Record<string, string> = {};
  for (let i = 0; i < strings.length; i += 60) {
    const batch = strings.slice(i, i + 60);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.RESTOQ_AI_MODEL || "claude-haiku-5-5",
        max_tokens: 8000,
        system: `You translate the user interface of Restoq, a stock, ordering and invoice-control app for bars and restaurants, from Norwegian Bokmål to ${target}. Keep it short, natural and consistent with restaurant/kitchen terminology. Keep placeholders like {0} exactly, keep product names, brand names (Restoq, Tripletex), codes and emoji unchanged. "kr" is Norwegian kroner (NOK).`,
        messages: [{ role: "user", content: `Translate each line. Return the translations in the same order. Always answer by calling the save tool.\n${batch.map((s, n) => `[${n + 1}] ${s}`).join("\n")}` }],
        tools: [{ name: "save", description: "Save the translations", input_schema: { type: "object", properties: { translations: { type: "array", items: { type: "string" } } }, required: ["translations"], additionalProperties: false }, strict: true }],
        tool_choice: { type: "auto" },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Oversettelse feilet (HTTP ${res.status}).`);
    const j = await res.json();
    const list: string[] = j?.content?.find((c: { type: string }) => c.type === "tool_use")?.input?.translations ?? [];
    batch.forEach((s, n) => {
      const t = list[n];
      const ph = (x: string) => (x.match(/\{\d+\}/g) ?? []).sort().join();
      if (t && ph(t) === ph(s)) out[s] = t;
    });
  }
  return out;
}
