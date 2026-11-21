// Leser leverandørfakturaer (PDF, bilde eller EHF/XML) med Claude og returnerer strukturerte data.
// Krever ANTHROPIC_API_KEY. Fakturaen sendes til Anthropic for tolkning (underleverandør, se /personvern).
import sharp from "sharp";

export const invoiceReaderEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export type ReadLine = { itemNo: string; gtin?: string; description: string; qty: number | null; unit: string; unitPrice: number | null; lineTotal: number | null; vatRate: number | null; storage: string; category: string; shelfDays: number | null };
export type ReadInvoice = {
  supplierName: string; supplierOrgNo: string; supplierAddress?: string; supplierPostalCode?: string; supplierCity?: string; supplierBankAccount?: string; supplierIban?: string; supplierBic?: string; supplierEmail?: string; supplierPhone?: string; supplierWebsite?: string; supplierContact?: string; customerNo?: string; invoiceNo: string; invoiceDate: string; dueDate: string; kid: string; orderRef: string;
  currency: string; amountExVat: number | null; vat: number | null; amount: number | null; isCreditNote: boolean; lines: ReadLine[]; warnings: string[];
};

const SCHEMA = {
  type: "object",
  properties: {
    supplierName: { type: "string", description: "Leverandørens (selgerens) navn, ikke kjøperens" },
    supplierOrgNo: { type: "string", description: "Leverandørens organisasjonsnummer, bare 9 sifre" },
    supplierAddress: { type: "string", description: "Leverandørens gateadresse eller postboks" },
    supplierPostalCode: { type: "string" }, supplierCity: { type: "string" },
    supplierBankAccount: { type: "string", description: "Leverandørens norske kontonummer (11 sifre) som det skal betales til" },
    supplierIban: { type: "string" }, supplierBic: { type: "string" },
    supplierEmail: { type: "string" }, supplierPhone: { type: "string" }, supplierWebsite: { type: "string" },
    supplierContact: { type: "string", description: "Kontaktperson/selger hos leverandøren hvis oppgitt" },
    customerNo: { type: "string", description: "Kjøperens kundenummer hos leverandøren" },
    invoiceNo: { type: "string" }, invoiceDate: { type: "string", description: "YYYY-MM-DD" }, dueDate: { type: "string", description: "YYYY-MM-DD eller tom" },
    kid: { type: "string" }, orderRef: { type: "string", description: "Ordrenummer, bestillingsreferanse eller pakkseddelnummer hvis oppgitt" },
    currency: { type: "string", description: "ISO-kode, normalt NOK" },
    amountExVat: { type: ["number", "null"] }, vat: { type: ["number", "null"] }, amount: { type: ["number", "null"], description: "Å betale inkl. mva" },
    isCreditNote: { type: "boolean" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          itemNo: { type: "string", description: "Leverandørens varenummer/artikkelnummer, tom hvis mangler" },
          gtin: { type: "string", description: "EAN/GTIN-strekkode hvis oppgitt, ellers tom" },
          description: { type: "string", description: "Varenavn slik det står på fakturaen" },
          qty: { type: ["number", "null"], description: "Fakturert antall (negativt på kreditlinjer)" },
          unit: { type: "string", description: "Enheten antallet gjelder, f.eks. stk, kg, l, krt, pk, fl" },
          unitPrice: { type: ["number", "null"], description: "Pris per enhet eks. mva etter rabatt" },
          lineTotal: { type: ["number", "null"], description: "Linjebeløp eks. mva" },
          vatRate: { type: ["number", "null"], description: "Mva-sats i prosent, f.eks. 15 eller 25" },
          storage: { type: "string", enum: ["Kjøl", "Frys", "Tørr", "Romtemp.", ""], description: "Anslått lagertype for varen" },
          category: { type: "string", description: "Kort kategori på norsk, f.eks. Meieri, Kjøtt, Fisk, Grønt, Tørrvarer, Drikke, Emballasje, Rengjøring" },
          shelfDays: { type: ["number", "null"], description: "Anslått typisk holdbarhet i dager for uåpnet vare" },
        },
        additionalProperties: false,
        required: ["itemNo", "gtin", "description", "qty", "unit", "unitPrice", "lineTotal", "vatRate", "storage", "category", "shelfDays"],
      },
    },
    warnings: { type: "array", items: { type: "string" }, description: "Korte merknader på norsk om noe er uleselig, usikkert eller ikke stemmer (f.eks. sum av linjer ≠ total)" },
  },
  additionalProperties: false,
  required: ["supplierName", "supplierOrgNo", "supplierAddress", "supplierPostalCode", "supplierCity", "supplierBankAccount", "supplierIban", "supplierBic", "supplierEmail", "supplierPhone", "supplierWebsite", "supplierContact", "customerNo", "invoiceNo", "invoiceDate", "dueDate", "kid", "orderRef", "currency", "amountExVat", "vat", "amount", "isCreditNote", "lines", "warnings"],
};

export async function readInvoice(file: { mime: string; data: Buffer; name: string }): Promise<ReadInvoice> {
  let content: unknown[];
  if (file.mime === "application/pdf") {
    content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data.toString("base64") } }];
  } else if (file.mime.startsWith("image/")) {
    // TIFF og store bilder gjøres om til JPEG som Claude leser (maks ca. 2000 px)
    const img = await sharp(file.data, { pages: 1 }).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    content = [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } }];
  } else if (file.mime.includes("xml")) {
    const xml = file.data.toString("utf8").replace(/<cbc:EmbeddedDocumentBinaryObject[\s\S]*?<\/cbc:EmbeddedDocumentBinaryObject>/g, "<!-- vedlegg fjernet -->").slice(0, 400_000);
    content = [{ type: "text", text: `EHF/UBL-faktura (XML):\n${xml}` }];
  } else throw new Error("Filtypen kan ikke leses automatisk.");

  // Claude Sonnet 5.5 godtar ikke tvungen verktøybruk (tool_choice "tool"/"any" gir HTTP 400).
  // Vi bruker derfor tool_choice "auto" med strict: true og ber tydelig om verktøyet; mangler kallet, prøver vi én gang til.
  const messages: unknown[] = [{ role: "user", content: [...content, { type: "text", text: "Hent ut fakturaen og lagre den med verktøyet save_invoice. Svar bare med verktøykallet." }] }];
  let out: ReadInvoice | undefined;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.RESTOQ_INVOICE_MODEL || "claude-sonnet-5-5",
        max_tokens: 32000,
        system: "Du leser innkommende leverandørfakturaer for en norsk restaurant eller bar og henter ut opplysningene nøyaktig slik de står. Bruk alltid verktøyet save_invoice til å levere resultatet. Ikke gjett tall: er noe uleselig eller mangler, bruk null eller tom tekst og skriv en merknad. Beløp er tall med punktum som desimaltegn. Ta med alle varelinjer, også pant, frakt og gebyrer (som egne linjer). Leverandøren er selgeren, ikke kjøperen.",
        messages,
        tools: [{ name: "save_invoice", description: "Lagre opplysningene fra fakturaen. Skal alltid kalles nøyaktig én gang.", input_schema: SCHEMA, strict: true }],
        tool_choice: { type: "auto" },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(await apiError(res));
    const j = await res.json();
    out = j?.content?.find((c: { type: string }) => c.type === "tool_use")?.input as ReadInvoice | undefined;
    if (!out) {
      if (j?.stop_reason === "max_tokens") throw new Error("Fakturaen er for lang til å leses på én gang. Del den opp eller legg inn linjene manuelt.");
      if (j?.stop_reason === "refusal") throw new Error("Claude kunne ikke lese denne filen.");
      messages.push({ role: "assistant", content: j?.content ?? [] }, { role: "user", content: "Lever resultatet med verktøyet save_invoice nå." });
    }
  }
  if (!out) throw new Error("Fant ingen fakturadata i svaret. Prøv igjen, eller legg inn fakturaen manuelt.");
  // Rydding og kontroll av summer
  out.supplierOrgNo = String(out.supplierOrgNo ?? "").replace(/\D/g, "").slice(-9);
  out.supplierBankAccount = String(out.supplierBankAccount ?? "").replace(/\D/g, "");
  out.lines = (out.lines ?? []).filter((l) => l && (l.description || l.itemNo)).slice(0, 400);
  out.warnings = out.warnings ?? [];
  const sum = out.lines.reduce((s, l) => s + (l.lineTotal ?? (l.qty ?? 0) * (l.unitPrice ?? 0)), 0);
  if (out.amountExVat != null && out.lines.length && Math.abs(sum - out.amountExVat) > Math.max(1, Math.abs(out.amountExVat) * 0.01))
    out.warnings.push(`Sum av linjene (${sum.toFixed(2)}) avviker fra beløp eks. mva (${out.amountExVat.toFixed(2)}). Sjekk linjene.`);
  if (out.currency && out.currency !== "NOK") out.warnings.push(`Fakturaen er i ${out.currency}, ikke NOK.`);
  return out;
}

/** Lesbar feilmelding fra Claude API (uten rå JSON). */
async function apiError(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  let msg = "";
  try { msg = JSON.parse(t)?.error?.message ?? ""; } catch { msg = t; }
  if (res.status === 401) return "ANTHROPIC_API_KEY er ugyldig.";
  if (res.status === 429 || res.status === 529) return "Claude er opptatt akkurat nå. Prøv igjen om litt.";
  if (res.status === 413) return "Filen er for stor til å leses. Maks 32 MB og 100 sider.";
  console.error("Claude API", res.status, msg.slice(0, 500));
  return `Kunne ikke lese fakturaen (HTTP ${res.status}). ${msg.slice(0, 160)}`.trim();
}
