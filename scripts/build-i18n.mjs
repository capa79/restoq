// Bygger public/i18n/<språk>.json fra i18n/translations.tsv (kolonner: nb, en, de, pl, es).
// Kjør «node scripts/build-i18n.mjs» etter at du har lagt til eller rettet tekster i TSV-filen.
import fs from "node:fs";
const rows = fs.readFileSync("i18n/translations.tsv", "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
const head = rows.shift();
fs.mkdirSync("public/i18n", { recursive: true });
for (let c = 1; c < head.length; c++) {
  const dict = {};
  for (const r of rows) if (r[c]) dict[r[0]] = r[c];
  fs.writeFileSync(`public/i18n/${head[c]}.json`, JSON.stringify(dict));
  console.log(`${head[c]}: ${Object.keys(dict).length} tekster`);
}
