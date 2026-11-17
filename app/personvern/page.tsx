import { SiteFooter, SiteNav } from "../site-chrome";

export const metadata = { title: "Personvern – Restoq" };

export default function Privacy() {
  const entity = process.env.LEGAL_ENTITY || "Restoq";
  const orgnr = process.env.LEGAL_ORGNR;
  const contact = process.env.PRIVACY_CONTACT || "post@restoq.no";
  return (
    <div className="site">
      <SiteNav links={false} />
      <main className="doc">
        <h1>Personvernerklæring</h1>
        <p>{entity}{orgnr ? ` (org.nr. ${orgnr})` : ""} er behandlingsansvarlig for personopplysninger som samles inn på restoq.no gjennom kontaktskjemaet, og databehandler for opplysningene kundene våre legger inn i appen.</p>
        <h2>Kontaktskjemaet</h2>
        <p>Når du sender en henvendelse, lagrer vi navn, firma, e-post, telefon og meldingen din for å kunne svare deg og følge opp en mulig avtale. Grunnlaget er vår berettigede interesse i å svare på henvendelser (personvernforordningen art. 6 nr. 1 bokstav f). Henvendelser som ikke fører til avtale, slettes senest etter 12 måneder.</p>
        <h2>Brukere av appen</h2>
        <p>For innloggede brukere lagrer vi navn, e-post, rolle, kryptert passord (eller kobling til Google-konto), tidspunkt for innlogging og en logg over hvem som har registrert hva (telling, bestilling, svinn, fakturagodkjenning). Opplysningene behandles på vegne av kunden, etter databehandleravtale med kunden.</p>
        <h2>Informasjonskapsler</h2>
        <p>Vi bruker bare én nødvendig informasjonskapsel for å holde deg innlogget. Vi bruker ikke analyse- eller reklamekapsler.</p>
        <h2>Lagring og underleverandører</h2>
        <p>Data lagres hos våre underleverandører for drift (Render) og database (Neon) på servere i EU. E-post sendes via Resend. Kobler kunden til Tripletex, sendes fakturaer og bilag dit etter kundens instruks.</p>
        <h2>Dine rettigheter</h2>
        <p>Du kan be om innsyn, retting og sletting, og klage til Datatilsynet. Kontakt oss på {contact}.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
