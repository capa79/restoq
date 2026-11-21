// Leser leverandørfakturaer (PDF, bilde eller EHF/XML) med Claude og returnerer strukturerte data.
// Krever ANTHROPIC_API_KEY. Fakturaen sendes til Anthropic for tolkning (underleverandør, se /personvern).
import sharp from "sharp";

export const invoiceReaderEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export type ReadLine = { itemNo: string; description: string; qty: number | null; unit: string; unitPrice: number | null; lineTotal: number | null; vatRate: number | null; storage: string; category: string; shelfDays: number | null };
export type ReadInvoice = {
  supplierName: string; supplierOrgNo: string; invoiceNo: string; invoiceDate: string; dueDate: string; kid: string; orderRef: string;
  currency: string; amountExVat: number | null; vat: number | null; amount: number | null; isCreditNote: boolean; lines: ReadLine[]; warnings: string[];
};

const SCHEMA = {
  type: "object",
  properties: {
    supplierName: { type: "string", description: "Leverandørens (selgerens) navn, ikke kjøperens" },
    supplierOrgNo: { type: "string", description: "Leverandørens organisasjonsnummer, bare 9 sifre" },
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
        required: ["itemNo", "description", "qty", "unit", "unitPrice", "lineTotal", "vatRate", "storage", "category", "shelfDays"],
      },
    },
    warnings: { type: "array", items: { type: "string" }, description: "Korte merknader på norsk om noe er uleselig, usikkert eller ikke stemmer (f.eks. sum av linjer ≠ total)" },
  },
  required: ["supplierName", "supplierOrgNo", "invoiceNo", "invoiceDate", "dueDate", "kid", "orderRef", "currency", "amountExVat", "vat", "amount", "isCreditNote", "lines", "warnings"],
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

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.RESTOQ_INVOICE_MODEL || "claude-sonnet-5-5",
      max_tokens: 16000,
      system: "Du leser innkommende leverandørfakturaer for en norsk restaurant eller bar og henter ut opplysningene nøyaktig slik de står. Ikke gjett tall: er noe uleselig eller mangler, bruk null eller tom tekst og skriv en merknad. Beløp er tall med punktum som desimaltegn. Ta med alle varelinjer, også pant, frakt og gebyrer (som egne linjer). Leverandøren er selgeren, ikke kjøperen.",
      messages: [{ role: "user", content: [...content, { type: "text", text: "Hent ut fakturaen med verktøyet save_invoice." }] }],
      tools: [{ name: "save_invoice", description: "Lagre opplysningene fra fakturaen", input_schema: SCHEMA }],
      tool_choice: { type: "tool", name: "save_invoice" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(res.status === 401 ? "ANTHROPIC_API_KEY er ugyldig." : res.status === 429 || res.status === 529 ? "Claude er opptatt akkurat nå. Prøv igjen om litt." : `Kunne ikke lese fakturaen (HTTP ${res.status}). ${t.slice(0, 120)}`);
  }
  const j = await res.json();
  const out = j?.content?.find((c: { type: string }) => c.type === "tool_use")?.input as ReadInvoice | undefined;
  if (!out) throw new Error("Fant ingen fakturadata i svaret.");
  // Rydding og kontroll av summer
  out.supplierOrgNo = String(out.supplierOrgNo ?? "").replace(/\D/g, "").slice(-9);
  out.lines = (out.lines ?? []).filter((l) => l && (l.description || l.itemNo)).slice(0, 400);
  out.warnings = out.warnings ?? [];
  const sum = out.lines.reduce((s, l) => s + (l.lineTotal ?? (l.qty ?? 0) * (l.unitPrice ?? 0)), 0);
  if (out.amountExVat != null && out.lines.length && Math.abs(sum - out.amountExVat) > Math.max(1, Math.abs(out.amountExVat) * 0.01))
    out.warnings.push(`Sum av linjene (${sum.toFixed(2)}) avviker fra beløp eks. mva (${out.amountExVat.toFixed(2)}). Sjekk linjene.`);
  if (out.currency && out.currency !== "NOK") out.warnings.push(`Fakturaen er i ${out.currency}, ikke NOK.`);
  return out;
}
