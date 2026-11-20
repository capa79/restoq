import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import { getUiLang } from "@/lib/i18n";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://restoq.no"),
  title: "Restoq – Intelligent resource management for barer og restauranter",
  description: "Varelager, bestillinger, varetelling, svinn og fakturakontroll i én plattform. Bestillingsforslag basert på salg og lager, og fakturaer rett til Tripletex.",
  alternates: { canonical: "/" },
  openGraph: { title: "Restoq – Plan. Allocate. Execute.", description: "One platform. Complete operational control. Lager, bestilling og fakturakontroll for barer og restauranter.", url: "https://restoq.no", siteName: "Restoq", locale: "nb_NO", type: "website" },
};
export const viewport: Viewport = { themeColor: "#141A18", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getUiLang();
  const v = (process.env.RENDER_GIT_COMMIT ?? "dev").slice(0, 7);
  return (
    <html lang={lang} className={lang === "nb" ? undefined : "i18n-wait"} data-i18n-v={v} suppressHydrationWarning>
      <head>
        {lang !== "nb" ? <meta name="google" content="notranslate" /> : null}
        {/* Vis siden uansett etter 2,5 sekunder, også om ordboka ikke kom fram */}
        {lang !== "nb" ? <script dangerouslySetInnerHTML={{ __html: "setTimeout(function(){document.documentElement.classList.remove('i18n-wait')},2500)" }} /> : null}
        <script src={`/restoq-i18n.js?v=${v}`} defer />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
