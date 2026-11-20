import { UI_LANGS, type UiLang } from "@/lib/i18n";

// Små flagg som SVG (flagg-emoji vises ikke i Windows)
export function Flag({ lang, size = 18 }: { lang: string; size?: number }) {
  const h = Math.round((size * 2) / 3);
  const p = { width: size, height: h, "aria-hidden": true, className: "flag" } as const;
  if (lang === "en") return (<svg {...p} viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169" /><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="8" /><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3" /><path d="M30 0v40M0 20h60" stroke="#fff" strokeWidth="12" /><path d="M30 0v40M0 20h60" stroke="#C8102E" strokeWidth="7" /></svg>);
  if (lang === "de") return (<svg {...p} viewBox="0 0 60 40"><rect width="60" height="13.4" fill="#000" /><rect y="13.3" width="60" height="13.4" fill="#DD0000" /><rect y="26.6" width="60" height="13.4" fill="#FFCE00" /></svg>);
  if (lang === "pl") return (<svg {...p} viewBox="0 0 60 40"><rect width="60" height="20" fill="#fff" /><rect y="20" width="60" height="20" fill="#DC143C" /><rect width="60" height="40" fill="none" stroke="#ccc" strokeWidth="1" /></svg>);
  if (lang === "es") return (<svg {...p} viewBox="0 0 60 40"><rect width="60" height="40" fill="#AA151B" /><rect y="10" width="60" height="20" fill="#F1BF00" /></svg>);
  return (<svg {...p} viewBox="0 0 22 16"><rect width="22" height="16" fill="#BA0C2F" /><path d="M6 0h4v16H6zM0 6h22v4H0z" fill="#fff" /><path d="M7 0h2v16H7zM0 7h22v2H0z" fill="#00205B" /></svg>);
}

const WORD: Record<string, string> = { nb: "Språk", en: "Language", de: "Sprache", pl: "Język", es: "Idioma" };

// Språkvelger uten JavaScript: en liten meny med lenker til /api/lang (som husker valget og sender deg tilbake)
export function LangSwitch({ current, tone = "dark" }: { current: UiLang; tone?: "dark" | "light" }) {
  const cur = UI_LANGS.find((l) => l.id === current) ?? UI_LANGS[0];
  return (
    <details className={`langsw ${tone}`} data-no-translate translate="no">
      <summary aria-label={WORD[current]}><Flag lang={cur.id} /> <span>{cur.short}</span></summary>
      <ul>
        {UI_LANGS.map((l) => (
          <li key={l.id}><a href={`/api/lang?l=${l.id}`} lang={l.id} aria-current={l.id === current ? "true" : undefined}><Flag lang={l.id} size={22} /> <b>{l.short}</b> {l.label}</a></li>
        ))}
      </ul>
    </details>
  );
}
