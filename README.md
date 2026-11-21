# Restoq

**Intelligent resource management** – Plan. Allocate. Execute.
Nettsted og app for Restoq (restoq.no): lager, bestilling, varetelling, svinn og fakturakontroll for barer og restauranter. Next.js 16 + Postgres, samme oppsett som Nextly.

- `/` – B2B-landingsside med kontaktskjema (henvendelser lagres og sendes på e-post)
- `/login` – e-post og passord, eller «Logg inn med Google»
- `/bytt-passord` – nye brukere velger eget passord første gang
- `/app` – dispo-appen for kunden (krever innlogging)
- `/admin` – Restoq-administrasjon: kunder, henvendelser, hendelseslogg
- `/api-dokumentasjon` – offentlig dokumentasjon av API v1
- `/personvern`

## Språk
Norsk, engelsk, tysk, polsk og spansk. Språkvelgeren (flagget) ligger i toppen av forsiden, innloggingen og appen. Valget huskes i en informasjonskapsel (`restoq_lang`) og på kontoen.
- Norsk er originalen. `public/restoq-i18n.js` bytter ut teksten i nettleseren med ordboka `public/i18n/<språk>.json`, også i dialoger og meldinger som kommer etterpå.
- Tall og datoer i en tekst erstattes med `{0}`, `{1}` … før oppslag, så «3 varer · 2 407 kr» slås opp som «{0} varer · {1} kr». Ukedager i datoer oversettes. Linjer med « · » oversettes del for del.
- Varenavn (`.iname`), leverandørnavn og alt merket `translate="no"` eller `data-no-translate` oversettes ikke. Admin- og utviklersidene er bare på norsk.
- Kilde for alle oversettelser: `i18n/translations.tsv` (kolonner nb, en, de, pl, es). Kjør `npm run i18n` etter endringer (skjer også ved `npm run build`).
## Avskrivning og varer fra faktura

- **Avskrivning** (tidligere Svinn): brekkasje, utgått på dato, bedervet/feil oppbevaring, feil i produksjon, overproduksjon, returnert av gjest, personalmat, representasjon og annet. Oversikt per periode over hva som avskrives mest og hvorfor: andel av varekjøp, største årsak, topp 10 varer, kategori, utvikling og forslag til tiltak. Personalmat og representasjon er uttak (mval. § 8-3 første ledd bokstav d og e, § 3-21) og holdes utenfor svinnet. CSV-eksport skiller kassert og uttak.
- **Leverandører** (Innstillinger → Leverandører): org.nr., adresse, kontonummer/IBAN, e-post, telefon, kundenummer, kontaktpersoner og leveringsdager. Org.nr. og kontonummer kontrolleres med modulus 11. Skannes en faktura fra ukjent leverandør, spørres brukeren om den skal opprettes (forhåndsutfylt fra fakturaen). Avviker kontonummeret på fakturaen fra det registrerte, vises en advarsel om mulig fakturasvindel.
- **Samme vare hos flere leverandører** (navn, størrelse, strekkode) varsles i bestilling, varer og fakturagjennomgang med den andre leverandørens pris omregnet per mengde.
- **Roller hos kunden:** administrator (legger til/fjerner brukere, endrer roller og alt annet) og ansatt. Minst én administrator per kunde.
- **Innkjøpskategorier** (Innstillinger → Kategorier, og i Kom i gang): hovedkategorier (Mat, Drikke, Emballasje, Rengjøring og hygiene, Driftsmateriell, Inventar, Annet) med underkategorier (Ferskt, Fryst, Tørrvarer …). Underkategori kan ha lagertype som settes på varen; hovedkategori kan merkes «telles og bestilles» (Inventar er av som standard). Valgfri regnskapskonto per hovedkategori. Restoq foreslår kategori fra varenavn og fakturaens tekst.
- **Logo:** merke B (påfyllingssirkel) + ordmerket «restoq» (Archivo ExtraBold som kurver). Komponenter i `app/logo.tsx`, favicon `app/icon.svg`, `app/apple-icon.png`. Logopakke (SVG, PDF, PNG, JPG, favicon) på `/brand/restoq-logopakke.zip`, generert med `scripts/logo/build.py`. Farger: #141A18 og #D2372B.
- **Kom i gang-veiviser** (Oversikt → «Start veiviseren», eller Innstillinger): 1) leverandører (manuelt eller lest fra fakturaer) og kategorier, 2) varer fra vareliste/lagerliste (Excel .xlsx eller CSV, mal: `/restoq-varemal.xlsx` med to grå eksempelrader merket «EKSEMPEL:» som hoppes over ved import, lages med `node scripts/make-template.mjs`) og/eller leverandørfakturaer (leses med Claude), med valg linje for linje, 3) beholdning: bruk antallene som første telling eller hopp over, 4) oppsummering.
- **Legg inn varer** manuelt, fra Excel/CSV eller fra faktura. En opplastet faktura leses av Claude (leverandør, linjer, priser, mva); nye varer opprettes og endrede priser oppdateres først etter godkjenning. Prisendringer lagres som prishistorikk på varen.

- Tekster som mangler oversettelse når en bruker ser dem, meldes til serveren og vises under **Utvikler → Oversettelser**. Der kan de oversettes eller rettes direkte (lagres i databasen og går foran ordboka), kopieres som oppgave, eller oversettes automatisk med Claude hvis `ANTHROPIC_API_KEY` er satt.

## Tilbakemeldinger, feillogg og utviklerside
- **«Gi tilbakemelding»** (knappen nede til høyre i appen): tekst, type, opptil 3 skjermbilder (krympes og renses for metadata i nettleseren) og automatisk kontekst – side, kunde, rolle, nettleser, versjon, siste feil og kall som feilet. Feil og «feil tall» varsles på e-post til utviklerne.
- **Feillogg**: feil på serveren (`instrumentation.ts`) og i nettleseren logges automatisk, lagres i 30 dager, like feil samles.
- **`/utvikler`** (admin og brukere med utviklerrolle): tilbakemeldinger med status, prioritet, tildeling, internt notat og «Kopier som oppgave» (ferdig beskrivelse til Claude Code eller en utvikler), feillogg, oversettelser og systemstatus.
- **Utviklerrolle** gis under Admin → Utviklere. En utvikler uten konto får en egen konto som bare ser `/utvikler`, ikke kundenes data.

## Kunder, brukere og roller
- **Kunde** (bar/restaurant) opprettes i `/admin` med e-post til leder. Lederen får midlertidig passord (på e-post hvis Resend er satt opp, ellers vises det i admin).
- **Leder** (`owner`): alt i appen, i tillegg innstillinger, varer, logo og farger, brukere, Tripletex, API-nøkler og godkjenning, sending og betaling av fakturaer.
- **Ansatt** (`staff`): teller, bestiller, tar imot varer, fører svinn og registrerer fakturaer og pakksedler.
- **Admin** (Restoq): kan åpne appen til hver kunde («Åpne app») og laste inn pilotdata.
- Hver kunde har egne data. Alle API-kall sjekker kunden mot innloggingen på serveren.

## Appen
Klientskriptet ligger i `public/restoq-app.js` og `public/restoq-app.css`, og er den samme koden som prototypen i Claude. Når siden har `<script id="boot">`, bruker den serveren (`/api/data`) og henter på nytt hvert 20. sekund, så alle ansatte ser samme tall.

### Beregning
- Har nå = talt − svinn siden telling − forbruk/uke ÷ 7 × dager siden telling + mottatt siden telling
- Forbruk/uke = manuelt, ellers faktisk forbruk per 100 000 kr i matsalg fra de to siste tellingene, ellers innkjøpshistorikk – ganget med forventet matsalg
- **Bestillingsfrekvens per lagertype** (standard: kjøl 3,5 d = 2×/uke, frys 7 d, tørr 14 d, romtemp. 14 d; kan endres under Innstillinger). Syklus = det største av frekvensen og leverandørens intervall mellom leveranser.
- Bestillingspunkt = forbruk/dag × (intervall + ledetid + sikkerhetsdager). Varen kommer på forslag først når tilgjengelig (lager + åpne ordre) er under bestillingspunktet.
- Mållager = forbruk/dag × min(holdbarhet, syklus + ledetid + sikkerhetsdager). Forslaget fyller opp til mållageret, rundet opp til pakningsstørrelse.
- Status: «Bestill nå» hvis dager igjen < ledetid + intervall, «Snart» hvis < + sikkerhetsdager.

### Oppstart for ny kunde
1. Leder legger inn leverandører (Innstillinger → Legg til leverandør) med leveringsdager og org.nr.
2. Varer importeres fra Excel/CSV (Varer → Importer varer). Kolonner: Leverandør, Varenr, Navn, Enhet, Pris, Lager, Kategori, Pakning, Holdbarhet, Forbruk per uke. Malen kan lastes ned i appen.
3. Første varetelling.
Pilotdata for About Contrasts ligger i `data/about-contrasts.json` og lastes inn fra `/admin`.

## Fakturaer og pakksedler
- Registreres i appen (fanen Faktura), via API v1, eller hentes fra Tripletex («Hent fra Tripletex» – leverandørfakturaer siste 60 dager, også EHF).
- **Trevei-matching** (`lib/invoices.ts`): faktura mot bestilling (antall og avtalt pris) og varemottak/pakkseddel (mottatt antall). Flagger fakturert mer enn mottatt, ikke bestilt, mottatt men ikke fakturert, ikke registrert mottatt, prisavvik over 2 % og ukjent vare. Totalbeløp eks. mva kontrolleres mot mottatt × avtalt pris (toleranse 1 %, minst 10 kr).
- Status: `kontroll` (ingen bestilling funnet) → `avvik` / `matchet` → `godkjent` → `sendt` (bilagsmottak i Tripletex) → `betalt` (lagt til betaling). Godkjenning med avvik krever kommentar. Alt logges i fakturaens historikk.
- Filer (PDF, PNG, JPEG, TIFF, WebP, EHF/XML, maks 10 MB) lagres i databasen. Filtypen sjekkes ut fra innholdet.

## Tripletex
Restoq er en *kommersiell integrasjon* (flere kunder). Det krever:
1. **Consumer token** fra Tripletex. Søk om integrasjon på developer.tripletex.no. Test i `api-test.tripletex.tech` først (`TRIPLETEX_ENV=test`). Godkjenning for produksjon tar ifølge Tripletex-utviklere typisk 2–3 uker. Sett `TRIPLETEX_ENV=prod` når den er godkjent.
2. Hver kunde lager et **employee token** i sin Tripletex (Brukerinnstillinger → API-tilgang, velg applikasjonen Restoq) og limer det inn under Innstillinger → Tripletex i appen. Tokenet krypteres med `SECRET_KEY` (AES-256-GCM). Kunden må ha tilleggsmodulen «Integrasjoner» i Tripletex (inkludert i noen pakker, tillegg i andre).

Endepunkter som brukes (`lib/tripletex.ts`):
| Formål | Kall |
|---|---|
| Øktnøkkel | `PUT /token/session/:create?consumerToken&employeeToken&expirationDate` (Basic Auth `0:<token>` i senere kall) |
| Test av kobling | `GET /token/session/>whoAmI` |
| Send faktura til bilagsmottak | `POST /ledger/voucher/importDocument` (multipart, PDF/PNG/JPEG/TIFF/EHF) |
| Hent leverandørfakturaer | `GET /supplierInvoice?invoiceDateFrom&invoiceDateTo` |
| Godkjenn | `PUT /supplierInvoice/{id}/:approve` |
| Legg til betaling | `POST /supplierInvoice/{id}/:addPayment?paymentType=…` |

**Må verifiseres i Tripletex-testmiljøet før produksjon:** HTTP-metode og parametre for `:approve` og `:addPayment` (særlig hva `paymentType` skal være – settes med `TRIPLETEX_PAYMENT_TYPE`), og feltnavn i svaret fra `/supplierInvoice`. Restoq bokfører ikke selv: fakturaen bokføres (konteres) i Tripletex. Utbetaling krever at banken er koblet til Tripletex.

## API v1 (for skannere, EDI og andre systemer)
Se `/api-dokumentasjon`. Nøkler lages av leder under Innstillinger → API-nøkler (`Authorization: Bearer rq_…`, bare hash lagres).
- `POST /api/v1/invoices`, `GET /api/v1/invoices[?status=]`, `GET /api/v1/invoices/:id`
- `POST /api/v1/packing-slips` (med `"receive": true` registreres varemottaket)
- `GET /api/v1/orders[?status=]`, `GET /api/v1/items`

## Miljøvariabler (Render → Environment)
| Navn | Beskrivelse |
|---|---|
| `DATABASE_URL` | Postgres. Neon, region AWS Frankfurt: «pooled connection string» med `sslmode=require` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Restoq-administrator (opprettes ved oppstart, minst 10 tegn) |
| `SECRET_KEY` | Minst 32 tegn. Krypterer Tripletex-nøkler. Ikke bytt etter at kunder har koblet til |
| `APP_URL` | `https://restoq.no` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Valgfri. Redirect: `https://restoq.no/api/auth/google/callback`. Bare brukere som finnes i Restoq slipper inn |
| `RESEND_API_KEY` / `MAIL_FROM` | E-post (invitasjoner, henvendelser). Domenet restoq.no må bekreftes hos Resend |
| `LEADS_EMAIL` | Mottaker av henvendelser fra forsiden (ellers `ADMIN_EMAIL`) |
| `TRIPLETEX_CONSUMER_TOKEN` / `TRIPLETEX_ENV` / `TRIPLETEX_PAYMENT_TYPE` | Tripletex (se over) |
| `ANTHROPIC_API_KEY` | Valgfri. Slår på automatisk lesing av fakturaer (PDF, bilde, EHF) og automatisk oversettelse på utviklersiden. Maks 150 fakturalesinger per kunde per døgn |
| `RESTOQ_INVOICE_MODEL` / `RESTOQ_AI_MODEL` | Valgfri. Modell for fakturalesing (standard claude-sonnet-5-5) og oversettelse (standard claude-haiku-5-5) |
| `LEGAL_ENTITY` / `LEGAL_ORGNR` / `PRIVACY_CONTACT` | Selskapet bak Restoq, vises i bunntekst og personvernerklæring |

Tabellene opprettes automatisk første gang appen kobler til databasen.

## Publisering
1. Opprett repo `capa79/restoq` på GitHub og push.
2. Neon: nytt prosjekt `restoq` i AWS Frankfurt, kopier pooled connection string.
3. Render: New → Blueprint → velg repoet (leser `render.yaml`). Fyll inn miljøvariablene.
4. Domene: Render → Settings → Custom Domains → `restoq.no` og `www.restoq.no`, og legg inn DNS-postene Render viser hos domeneleverandøren.
5. Google Cloud: OAuth-klient med redirect over. Resend: bekreft restoq.no.

## Sikkerhet
- Passord: scrypt (N=2^15, r=8, p=1) med salt. Sesjoner 30 dager, bare hash av nøkkelen lagres.
- Etter 8 feil på samme e-post eller 30 fra samme IP stenges innlogging i 15 minutter.
- Alle endringer krever samme opphav (vern mot CSRF). Oppsett kan bare endres av leder.
- Kontaktskjema med honningkrukke og grense per IP.

## Lokalt
```
npm install
cp .env.example .env.local   # fyll inn
npm run dev
```

## Planday (omsetningsplan og faktisk omsetning)

Restoq leser daglige omsetningsbudsjetter (`GET /revenue/v1.0/budgets`) og daglig omsetning (`GET /revenue/v1.0/revenue`) fra Planday Open API og viser dem i kalenderen på Oversikt, sammen med bestillingsfrister og leveranser.

Oppsett:
1. Opprett én Planday-app for Restoq (i en Planday-portal: Innstillinger → API-tilgang → Opprett app) med tilgangene `revenue:read` og `department:read`. App-ID-en settes som `PLANDAY_CLIENT_ID` i Render. `SECRET_KEY` (minst 32 tegn) må også være satt, fordi tokenet lagres kryptert.
2. Kunden kobler appen til sin Planday-portal (Innstillinger → API-tilgang → Koble til app, med Restoqs app-ID), kopierer tokenet og limer det inn under Innstillinger → Planday i Restoq.
3. Restoq henter tilgangstoken fra `https://id.planday.com/connect/token` (gyldig 1 time) og kaller API-et med `X-ClientId` + `Authorization: Bearer`.

Valg hos kunden: hvilke avdelinger som tas med, og om omsetningsplanen for de neste 7 dagene (× matandel) skal brukes som forventet salg i bestillingsforslagene.
For testing kan `PLANDAY_API_BASE` og `PLANDAY_TOKEN_URL` overstyres.
