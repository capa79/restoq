import { SiteFooter, SiteNav } from "../site-chrome";

export const metadata = { title: "API-dokumentasjon – Restoq" };

const ex1 = `curl -X POST https://restoq.no/api/v1/invoices \\
  -H "Authorization: Bearer rq_xxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "supplier": "SG",
    "invoiceNo": "104882",
    "invoiceDate": "2026-11-17",
    "dueDate": "2026-12-01",
    "amountExVat": 1375.60,
    "vat": 206.34,
    "amount": 1581.94,
    "kid": "000104882",
    "lines": [
      { "itemNo": "545657", "description": "SMØR 500G", "qty": 8, "unitPrice": 62.50 },
      { "itemNo": "2474740", "description": "HELMELK 1L", "qty": 40, "unitPrice": 21.89 }
    ],
    "file": { "name": "faktura-104882.pdf", "contentBase64": "JVBERi0xLjcK..." }
  }'`;
const res1 = `HTTP/1.1 201 Created
{
  "id": "m3k9x2ab12cd",
  "status": "avvik",
  "orderId": "lq8w1z3k",
  "match": {
    "ok": false,
    "issues": [
      "Fakturert 1375.60 kr eks. mva, forventet 1250.60 kr ut fra mottatte varer og avtalte priser.",
      "1 varelinje har avvik."
    ],
    "expectedExVat": 1250.60,
    "invoicedExVat": 1375.60,
    "lines": [ { "itemNo": "545657", "ordered": 8, "received": 6, "invoiced": 8, "flags": ["Fakturert 8, mottatt 6"] } ]
  }
}`;
const ex2 = `curl -X POST https://restoq.no/api/v1/packing-slips \\
  -H "Authorization: Bearer rq_xxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "supplier": "SG",
    "slipNo": "PS-77812",
    "date": "2026-11-17",
    "receive": true,
    "lines": [ { "itemNo": "545657", "qty": 6 }, { "itemNo": "2474740", "qty": 40 } ]
  }'`;

const ex3 = `curl -X POST https://restoq.no/api/v1/sales \\
  -H "Authorization: Bearer rq_xxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "weeks": [ { "weekStart": "2026-11-16", "food": 92770, "total": 224405 } ] }'`;
const ex4 = `curl -X POST https://restoq.no/api/v1/sales \\
  -H "Authorization: Bearer rq_xxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "days": [ { "date": "2026-11-21", "food": 14250.40, "total": 38110.00 } ] }'`;
const ex5 = `# Send dagens salgsrapport fra kassen (Excel/CSV) hver natt, f.eks. med cron eller Planlagte oppgaver
f=salgsrapport.xlsx
printf '{"file":{"name":"%s","contentBase64":"%s"}}' "$f" "$(base64 -w0 "$f")" | \\
  curl -X POST https://restoq.no/api/v1/sales \\
    -H "Authorization: Bearer rq_xxxxxxxxxxxxxxxxxxxxxxxx" \\
    -H "Content-Type: application/json" --data-binary @-`;

export default function ApiDocs() {
  return (
    <div className="site">
      <SiteNav links={false} />
      <main className="doc" data-no-translate>
        <h1>Restoq API v1</h1>
        <p>Med API-et kan skannere, EDI-løsninger, kassesystemer og andre systemer registrere leverandørfakturaer, pakksedler og salg i Restoq. Restoq matcher dem automatisk mot bestilling og varemottak. Godkjenning, sending til regnskap og betaling gjøres av leder i appen.</p>

        <h2>Autentisering</h2>
        <p>Leder lager en API-nøkkel under <b>Innstillinger → API-nøkler</b>. Nøkkelen gjelder for ett utsted og sendes i hver forespørsel:</p>
        <pre>Authorization: Bearer rq_xxxxxxxxxxxxxxxxxxxxxxxx</pre>
        <p>Nøkkelen vises bare én gang. Behandle den som et passord, og slett den i appen hvis den kommer på avveie. Alle kall går over HTTPS og bruker JSON.</p>

        <h2>Endepunkter</h2>
        <table>
          <thead><tr><th>Metode og sti</th><th>Hva</th></tr></thead>
          <tbody>
            <tr><td><code>POST /api/v1/invoices</code></td><td>Registrer leverandørfaktura. Matches med en gang.</td></tr>
            <tr><td><code>GET /api/v1/invoices?status=avvik</code></td><td>List fakturaer (filter: kontroll, avvik, matchet, godkjent, sendt, betalt, avvist).</td></tr>
            <tr><td><code>GET /api/v1/invoices/:id</code></td><td>Faktura med matching og historikk.</td></tr>
            <tr><td><code>POST /api/v1/packing-slips</code></td><td>Registrer pakkseddel, valgfritt med varemottak.</td></tr>
            <tr><td><code>GET /api/v1/orders?status=bestilt</code></td><td>Bestillinger med linjer (for å koble skannede dokumenter).</td></tr>
            <tr><td><code>GET /api/v1/items</code></td><td>Varekatalog: leverandør, varenummer, navn, enhet og avtalt pris.</td></tr>
            <tr><td><code>POST /api/v1/sales</code></td><td>Salg per uke eller dag fra kassesystemet (matsalg og totalt, eks. mva).</td></tr>
            <tr><td><code>GET /api/v1/sales</code></td><td>Salg per uke som er lagret.</td></tr>
          </tbody>
        </table>

        <h2>Registrer faktura</h2>
        <pre>{ex1}</pre>
        <table>
          <thead><tr><th>Felt</th><th>Beskrivelse</th></tr></thead>
          <tbody>
            <tr><td><code>supplier</code> *</td><td>Leverandørkoden fra Innstillinger, f.eks. <code>SG</code>.</td></tr>
            <tr><td><code>invoiceNo</code> *</td><td>Fakturanummer. Samme nummer fra samme leverandør avvises som duplikat.</td></tr>
            <tr><td><code>invoiceDate</code>, <code>dueDate</code></td><td>Datoer på formen ÅÅÅÅ-MM-DD.</td></tr>
            <tr><td><code>amountExVat</code>, <code>vat</code>, <code>amount</code></td><td>Beløp eks. mva, mva og totalt å betale (NOK).</td></tr>
            <tr><td><code>orderId</code></td><td>Restoq-bestillingen. Utelates den, finner Restoq beste treff hos leverandøren rundt fakturadatoen.</td></tr>
            <tr><td><code>lines[]</code></td><td><code>itemNo</code> (leverandørens varenummer), <code>description</code>, <code>qty</code>, <code>unitPrice</code> eks. mva.</td></tr>
            <tr><td><code>file</code></td><td>Valgfritt vedlegg: <code>{"{"} name, contentBase64 {"}"}</code>. PDF, PNG, JPEG, TIFF eller EHF (XML), maks 10 MB. Kreves for å sende fakturaen til regnskapet.</td></tr>
          </tbody>
        </table>
        <p>Svar:</p>
        <pre>{res1}</pre>

        <h3>Matching</h3>
        <p>Hver varelinje sammenlignes med bestilt antall, mottatt antall (fra varemottak eller pakkseddel) og avtalt pris. Restoq markerer: fakturert mer enn mottatt, ikke bestilt, mottatt men ikke fakturert, ikke registrert mottatt, prisavvik over 2 % og ukjent vare. Totalbeløpet eks. mva sammenlignes med forventet beløp (mottatt × avtalt pris) med toleranse på 1 %, minst 10 kr. Status blir <code>matchet</code>, <code>avvik</code> eller <code>kontroll</code> (ingen bestilling funnet).</p>

        <h2>Registrer pakkseddel</h2>
        <pre>{ex2}</pre>
        <p>Med <code>"receive": true</code> registreres varemottaket på den åpne bestillingen med pakkseddelens antall. Varer som står på bestillingen, men ikke på pakkseddelen, registreres som 0 mottatt.</p>

        <h2 id="salg">Salg fra kassesystemet</h2>
        <p>Salg per uke styrer forventet matsalg og alle forbruksprognoser. Kassesystemet, eller et lite skript som henter rapporten fra kassen, kan sende tallene automatisk. Uker som finnes fra før (samme mandag), blir erstattet. Alle beløp er NOK eks. mva.</p>
        <pre>{ex3}</pre>
        <p>Dagstall summeres per uke (mandag–søndag). Send gjerne hele uka på nytt hver natt, så blir uka riktig når den er ferdig:</p>
        <pre>{ex4}</pre>
        <table>
          <thead><tr><th>Felt</th><th>Beskrivelse</th></tr></thead>
          <tbody>
            <tr><td><code>weeks[].weekStart</code> *</td><td>Mandagen uka starter (ÅÅÅÅ-MM-DD). Alternativt <code>week</code> + <code>year</code> (ISO-uke).</td></tr>
            <tr><td><code>days[].date</code> *</td><td>Datoen for dagstall.</td></tr>
            <tr><td><code>food</code> *</td><td>Matsalg eks. mva.</td></tr>
            <tr><td><code>total</code></td><td>Total omsetning eks. mva (mat, drikke og annet). Utelates den, hentes totalen fra Planday hvis Planday er koblet til.</td></tr>
            <tr><td><code>file</code></td><td>I stedet for tall: salgsrapporten som fil, <code>{"{"} name, contentBase64 {"}"}</code> (Excel eller CSV). Samme formater som «Last opp salgsrapport» i appen: uketabell, dagstabell eller salg per kategori. Ved salg per kategori er matsalg summen av «Matkategorier» i Innstillinger. Uten dato i rapporten må <code>weekStart</code> sendes med.</td></tr>
          </tbody>
        </table>
        <pre>{ex5}</pre>

        <h2>Regnskap (Tripletex)</h2>
        <p>Når leder har koblet Restoq til Tripletex (Innstillinger → Regnskap), sendes godkjente fakturaer til bilagsmottaket i Tripletex for bokføring. Leverandørfakturaer som allerede ligger i Tripletex, for eksempel EHF, hentes inn og matches i stedet for å sendes på nytt. Når fakturaen er bokført i Tripletex, kan den godkjennes og legges til betaling derfra via Restoq. Selve utbetalingen skjer gjennom banken som er koblet til Tripletex.</p>

        <h2>Feil</h2>
        <table>
          <thead><tr><th>Kode</th><th>Betydning</th></tr></thead>
          <tbody>
            <tr><td>401</td><td>Mangler eller ugyldig API-nøkkel.</td></tr>
            <tr><td>404</td><td>Fant ikke ressursen.</td></tr>
            <tr><td>400 / 422</td><td>Ugyldige data, f.eks. ukjent leverandør, duplikat eller salgstall som ikke kan leses. Se <code>message</code>.</td></tr>
          </tbody>
        </table>
      </main>
      <SiteFooter />
    </div>
  );
}
