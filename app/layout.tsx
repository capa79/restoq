import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://restoq.no"),
  title: "Restoq – Intelligent resource management for barer og restauranter",
  description: "Varelager, bestillinger, varetelling, svinn og fakturakontroll i én plattform. Bestillingsforslag basert på salg og lager, og fakturaer rett til Tripletex.",
  alternates: { canonical: "/" },
  openGraph: { title: "Restoq – Plan. Allocate. Execute.", description: "One platform. Complete operational control. Lager, bestilling og fakturakontroll for barer og restauranter.", url: "https://restoq.no", siteName: "Restoq", locale: "nb_NO", type: "website" },
};
export const viewport: Viewport = { themeColor: "#141A18", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
