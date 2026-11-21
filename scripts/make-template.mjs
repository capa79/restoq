// Lager Excel-malen for vareimport: public/restoq-varemal.xlsx (kjør: node scripts/make-template.mjs)
import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
wb.creator = "Restoq"; wb.created = new Date();
const COLS = [
  ["Leverandør", 22, "Kode (f.eks. SG) eller navn (f.eks. Servicegrossisten). Ukjente leverandører opprettes.", "Ja", "Servicegrossisten"],
  ["Varenr", 12, "Leverandørens varenummer, slik det står på fakturaen. Mangler det, får varen et eget Restoq-nummer (RE-000001 …).", "Anbefalt", "545657"],
  ["Varenavn", 38, "Navnet på varen, gjerne som på fakturaen. Ta med størrelse (500G, 1L, 24X250ML) – da kan Restoq sammenligne priser.", "Ja", "SMØR USALTET 500G"],
  ["Enhet", 9, "Enheten dere teller og bestiller i: stk, kg, l, krt, pk, fl, boks.", "Ja", "stk"],
  ["Pris per enhet", 14, "Innkjøpspris eks. mva per enhet. Brukes til lagerverdi og avskrivning.", "Anbefalt", 62.5],
  ["Lager", 11, "Kjøl, Frys, Tørr eller Romtemp. Styrer hvor ofte varen bør bestilles.", "Anbefalt", "Kjøl"],
  ["Kategori", 16, "Fritt valgt, f.eks. Meieri, Kjøtt, Grønt, Drikke, Tørrvarer, Emballasje.", "Nei", "Meieri"],
  ["Pakning", 10, "Minste antall som kan bestilles (f.eks. 6 hvis varen selges i kartong à 6).", "Nei", 1],
  ["Holdbarhet (dager)", 12, "Typisk holdbarhet for uåpnet vare. Hindrer at det bestilles mer enn det rekker å brukes.", "Nei", 30],
  ["Forbruk per uke", 12, "Anslag på forbruk per uke i samme enhet. Kan stå tomt – Restoq beregner det etter to tellinger.", "Nei", 10],
  ["Beholdning (antall)", 12, "Antall på lager nå. Fylles det ut, kan det brukes som første varetelling i Kom i gang.", "Nei", 4],
  ["Utløpsdato", 13, "Tidligste utløpsdato på lageret (åååå-mm-dd). Gir varsel om fare for avskrivning.", "Nei", "2026-12-15"],
];
const RED = "FFD2372B", INK = "FF141A18", GREY = "FFF3F2EF";
// Ark 1: Varer
const ws = wb.addWorksheet("Varer", { views: [{ state: "frozen", ySplit: 1 }], properties: { tabColor: { argb: RED } } });
ws.columns = COLS.map(([h, w]) => ({ header: h, width: w }));
const head = ws.getRow(1);
head.height = 30;
head.eachCell((c, i) => {
  const req = COLS[i - 1][3] === "Ja";
  c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: req ? RED : INK } };
  c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  c.note = { texts: [{ text: (req ? "Påkrevd. " : "") + COLS[i - 1][2] }] };
});
const N = 1000;
for (let r = 2; r <= N; r++) {
  ws.getCell(`F${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Kjøl,Frys,Tørr,Romtemp."'], showErrorMessage: true, errorTitle: "Lager", error: "Velg Kjøl, Frys, Tørr eller Romtemp." };
  ws.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"stk,kg,l,krt,pk,fl,boks,g,dl"'], showErrorMessage: false };
  for (const col of ["E", "H", "I", "J", "K"]) ws.getCell(`${col}${r}`).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: "Tall", error: "Skriv et tall (0 eller mer)." };
  ws.getCell(`L${r}`).dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(2020, 0, 1)], showErrorMessage: true, errorTitle: "Dato", error: "Skriv en dato, f.eks. 2026-12-15." };
  ws.getCell(`E${r}`).numFmt = "#,##0.00"; ws.getCell(`L${r}`).numFmt = "yyyy-mm-dd";
}
// To eksempellinjer, tydelig merket. Restoq hopper over rader der varenavnet starter med «EKSEMPEL».
const EX = [
  ["Servicegrossisten", "545657", "EKSEMPEL: SMØR USALTET 500G", "stk", 62.5, "Kjøl", "Meieri", 1, 30, 10, 4, new Date(2026, 11, 15)],
  ["Odd Langdalen", "1009", "EKSEMPEL: AGURK NORSK", "stk", 12.9, "Kjøl", "Grønt", 12, 10, 24, null, null],
];
EX.forEach((vals, i) => {
  const row = ws.getRow(2 + i); row.values = vals;
  row.eachCell({ includeEmpty: true }, (c, col) => { if (col > 12) return; c.font = { italic: true, color: { argb: "FF8A938F" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F4" } }; });
});
ws.getCell("C2").note = { texts: [{ text: "Eksempel – blir ikke importert. Skriv over eller slett eksempelradene, og fyll inn deres egne varer fra rad 4." }] };
ws.autoFilter = { from: "A1", to: "L1" };
// Ark 2: Veiledning
const g = wb.addWorksheet("Veiledning", { properties: { tabColor: { argb: INK } } });
g.columns = [{ width: 22 }, { width: 12 }, { width: 80 }, { width: 24 }];
g.mergeCells("A1:D1"); g.getCell("A1").value = "Restoq – mal for vareimport"; g.getCell("A1").font = { bold: true, size: 16, color: { argb: INK } };
g.mergeCells("A2:D2"); g.getCell("A2").value = "Fyll ut arket «Varer» med én vare per rad, og last filen opp i Restoq under Kom i gang (eller Varer → Legg inn varer → Importer vareliste). Du velger selv hvilke varer som tas med, og om beholdningen skal brukes som første telling."; g.getCell("A2").alignment = { wrapText: true, vertical: "top" }; g.getRow(2).height = 48;
const gh = g.getRow(4); gh.values = ["Kolonne", "Påkrevd", "Forklaring", "Eksempel"];
gh.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; });
COLS.forEach(([h, , desc, req, ex], i) => {
  const row = g.getRow(5 + i); row.values = [h, req, desc, ex];
  row.getCell(3).alignment = { wrapText: true, vertical: "top" }; row.getCell(1).font = { bold: true };
  if (req === "Ja") row.getCell(2).font = { bold: true, color: { argb: RED } };
  if (i % 2) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; });
});
let y = 5 + COLS.length + 1;
g.getCell(`A${y}`).value = "Eksempelrader"; g.getCell(`A${y}`).font = { bold: true, size: 13 }; y++;
const ex = [
  COLS.map((c) => c[0]),
  ["Servicegrossisten", "545657", "SMØR USALTET 500G", "stk", 62.5, "Kjøl", "Meieri", 1, 30, 10, 4, "2026-12-15"],
  ["Servicegrossisten", "5104906", "RED BULL REGULAR 24X250ML", "krt", 351, "Romtemp.", "Drikke", 1, 365, 2, 3, ""],
  ["Odd Langdalen", "1009", "AGURK NORSK", "stk", 12.9, "Kjøl", "Grønt", 12, 10, 24, "", ""],
  ["MA", "7641", "RIS JASMIN 20KG", "sekk", 520, "Tørr", "Tørrvarer", 1, 365, 0.5, 1, ""],
];
ex.forEach((vals, i) => { const row = g.getRow(y + i); row.values = vals; if (i === 0) row.eachCell((c) => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; }); else row.font = { italic: true, color: { argb: "FF5D6965" } }; });
y += ex.length + 1;
const tips = [
  "Tips",
  "• Eksempelradene (de grå radene merket «EKSEMPEL:» i arket «Varer», og radene her) blir ikke importert. Dere kan slette dem eller skrive over dem.",
  "• Har dere allerede en vareliste i Excel, kan dere også laste den opp direkte. Restoq kjenner igjen vanlige kolonnenavn, og du kan velge kolonnene selv.",
  "• Mangler leverandørkolonnen, velger du én leverandør for hele lista ved opplasting.",
  "• Varer som finnes fra før (samme leverandør og varenr), oppdateres ikke dobbelt – de vises som «finnes».",
  "• Priser er eks. mva. Bruk punktum eller komma som desimaltegn.",
];
tips.forEach((t, i) => { g.mergeCells(`A${y + i}:D${y + i}`); const c = g.getCell(`A${y + i}`); c.value = t; c.alignment = { wrapText: true }; if (!i) c.font = { bold: true, size: 13 }; });
await wb.xlsx.writeFile("public/restoq-varemal.xlsx");
console.log("public/restoq-varemal.xlsx");
