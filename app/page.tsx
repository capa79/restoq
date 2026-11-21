import Link from "next/link";
import { SiteFooter, SiteNav } from "./site-chrome";
import { leadAction } from "./lead-actions";

const I = {
  clock: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.5 2.1-.8 1.3L11 13V7h2z" />,
  cart: <path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5.2 5H21l-2 8H7.4l-.4 2H19v2H4.6l1.6-8L4 3H1V1h4.2z" />,
  cal: <path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm12 8v10H5V10z" />,
  check: <path d="M19 3h-4.2A3 3 0 0 0 12 1a3 3 0 0 0-2.8 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-9 14-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9z" />,
  bin: <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z" />,
  doc: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9zM8 13h8v2H8zm0 4h8v2H8z" />,
  users: <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4zm8 0c-.3 0-.7 0-1.1.1 1.3.9 2.1 2.2 2.1 3.9v3h7v-3c0-2.7-5.3-4-8-4z" />,
  plug: <path d="M16 7V3h-2v4h-4V3H8v4H7a1 1 0 0 0-1 1v4a6 6 0 0 0 5 5.9V22h2v-4.1a6 6 0 0 0 5-5.9V8a1 1 0 0 0-1-1z" />,
};
const Ico = ({ d }: { d: React.ReactNode }) => <span className="ico"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{d}</svg></span>;

export default async function Home({ searchParams }: { searchParams: Promise<{ takk?: string; feil?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="site">
      <SiteNav />
      <div className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">Intelligent resource management</span>
            <h1><span>Plan.</span><span>Allocate.</span><span>Execute.</span></h1>
            <p className="tag">One platform. Complete operational control.</p>
            <p className="lead">Restoq gir barer og restauranter kontroll på hele varestrømmen: hva som står på lager, hvor lenge det holder, hva som bør bestilles – og om fakturaen stemmer med det som faktisk ble levert, før den går til regnskapet.</p>
            <div className="ctas"><a className="btn red" href="#kontakt">Book en demo</a><Link className="btn ghost" href="/login">Logg inn</Link></div>
          </div>
          <div className="shot" role="img" aria-label="Skjermbilde av Restoq-appen med kundens egen logo: oversikt over varer som må bestilles, og varer som går tom først">
            <div className="bar"><span className="lg">B</span><b>Bistro Nord</b><small>powered by Restoq</small></div>
            <div className="body">
              <div className="tiles">
                <div className="t r"><i>Bestill nå</i><b>7</b></div><div className="t a"><i>Snart</i><b>12</b></div><div className="t g"><i>Svinnrisiko</i><b>2</b></div><div className="t b"><i>Lagerverdi</i><b className="num">84 210</b></div>
              </div>
              <table>
                <thead><tr><th>Går tom først</th><th className="n">Har</th><th>Holder</th><th className="n">Forslag</th></tr></thead>
                <tbody>
                  <tr><td>Kyllingfilet 5 kg</td><td className="n">1</td><td><span className="barline"><span style={{ width: "8%", background: "#b42318" }} /></span>1 d</td><td className="n"><b>4</b></td></tr>
                  <tr><td>Helmelk 1 L</td><td className="n">9</td><td><span className="barline"><span style={{ width: "12%", background: "#b42318" }} /></span>2 d</td><td className="n"><b>24</b></td></tr>
                  <tr><td>Brioche 6×750 g</td><td className="n">3</td><td><span className="barline"><span style={{ width: "30%", background: "#9a5b00" }} /></span>6 d</td><td className="n"><b>4</b></td></tr>
                  <tr><td>Cheddar skivet 1 kg</td><td className="n">5</td><td><span className="barline"><span style={{ width: "34%", background: "#9a5b00" }} /></span>7 d</td><td className="n"><b>6</b></td></tr>
                </tbody>
              </table>
              <table>
                <thead><tr><th>Faktura</th><th>Leverandør</th><th className="n">Beløp</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td>104882</td><td>Grossist</td><td className="n">14 892</td><td><span className="pill g">Matchet</span></td></tr>
                  <tr><td>55120</td><td>Frukt &amp; grønt</td><td className="n">3 905</td><td><span className="pill r">Avvik</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <section id="slik">
        <div className="wrap">
          <div className="sec-head"><span className="eyebrow">Slik fungerer det</span><h2>Fra kjølerommet til betalt faktura</h2><p>Fire enkle rutiner for de ansatte. Resten regner Restoq ut: beholdning, hvor mange dager den holder, og hva som bør bestilles.</p></div>
          <div className="steps">
            <div className="step"><div className="no">01 · TELL</div><h3>Varetelling</h3><p>Én gang i måneden, hylle for hylle: kjøl, frys, tørr. Store knapper, fungerer på nettbrett og mobil, lagres mens du teller.</p></div>
            <div className="step"><div className="no">02 · PLAN</div><h3>Bestillingsforslag</h3><p>Forslag per leverandør ut fra salg, lager, åpne ordre, holdbarhet og leveringsdager. Juster med + og −, og send.</p></div>
            <div className="step"><div className="no">03 · MOTTA</div><h3>Varemottak</h3><p>Sjekk varene mot bestillingen eller pakkseddelen. Avvik registreres med en gang, og lageret oppdateres.</p></div>
            <div className="step"><div className="no">04 · KONTROLLER</div><h3>Faktura og betaling</h3><p>Fakturaen matches mot bestilling og mottak. Når den stemmer, godkjennes den og går til regnskapet for bokføring og betaling.</p></div>
          </div>
        </div>
      </section>

      <section id="funksjoner" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head"><span className="eyebrow">Funksjoner</span><h2>Alt kjøkkenet og baren trenger – ingenting de ikke trenger</h2></div>
          <div className="grid4">
            <div className="card"><Ico d={I.clock} /><h3>Dager på lager</h3><p>Se hvor lenge hver vare holder, og når den går tom, basert på faktisk forbruk og forventet salg.</p></div>
            <div className="card"><Ico d={I.cart} /><h3>Smarte forslag</h3><p>Forslag rundes opp til pakningsstørrelse og begrenses av holdbarhet, så dere slipper både tomme hyller og kast.</p></div>
            <div className="card"><Ico d={I.cal} /><h3>Bestillingsfrekvens</h3><p>Ferskvare, frys og tørrvare har hver sin rytme. Færre, større ordre der det lønner seg – mindre frakt og gebyrer.</p></div>
            <div className="card"><Ico d={I.check} /><h3>Månedlig telling</h3><p>Tellingen viser faktisk forbruk per 100 000 kr i salg, og forslagene blir mer presise for hver måned.</p></div>
            <div className="card"><Ico d={I.bin} /><h3>Svinn</h3><p>Registrer det som kastes på sekunder. Se hva utgått og skadet vare koster, og få varsel før noe går ut på dato.</p></div>
            <div className="card"><Ico d={I.doc} /><h3>Fakturakontroll</h3><p>Trevei-matching av bestilling, pakkseddel og faktura. Pris- og mengdeavvik vises før noen godkjenner.</p></div>
            <div className="card"><Ico d={I.plug} /><h3>Regnskap og API</h3><p>Godkjente fakturaer går rett til bilagsmottaket i regnskapssystemet (i dag Tripletex). Åpent API for skannere, EDI og andre systemer.</p></div>
            <div className="card"><Ico d={I.users} /><h3>Roller og tilgang</h3><p>Ansatte teller, bestiller og tar imot. Ledere styrer oppsett, godkjenner fakturaer og administrerer brukere.</p></div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head"><span className="eyebrow">Anbefalt bestillingsrytme</span><h2>Riktig frekvens for hver varetype</h2><p>Restoq starter med anbefalte frekvenser per lagertype. Dere kan justere dem, og appen bestiller aldri oftere enn leverandøren leverer eller mer enn holdbarheten tåler.</p></div>
          <div className="freq">
            <div className="fq k"><b>2× i uka</b><span>Ferskvare (kjøl) – frukt, grønt, meieri, kjøtt og fisk</span></div>
            <div className="fq f"><b>1× i uka</b><span>Frysevarer – brød, pommes frites, proteiner</span></div>
            <div className="fq t"><b>Annenhver uke</b><span>Tørrvare – hermetikk, krydder, olje, pasta</span></div>
            <div className="fq r"><b>Annenhver uke</b><span>Romtemperatur – drikke, emballasje, renhold</span></div>
          </div>
        </div>
      </section>

      <section id="faktura" className="dark">
        <div className="wrap">
          <div className="sec-head"><span className="eyebrow">Faktura og regnskap</span><h2>Ingen faktura betales før den stemmer</h2><p>Fakturaer og pakksedler registreres i appen, via API eller hentes fra regnskapssystemet (også EHF). Restoq matcher dem mot bestilling og varemottak, og leder godkjenner med ett trykk.</p></div>
          <div className="flow">
            <div className="node"><b>Bestilling</b><span>Antall og avtalt pris per vare</span></div><span className="arr">→</span>
            <div className="node"><b>Pakkseddel og mottak</b><span>Hva som faktisk kom</span></div><span className="arr">→</span>
            <div className="node"><b>Faktura</b><span>Mengde og pris kontrolleres automatisk</span></div><span className="arr">→</span>
            <div className="node"><b>Godkjenning</b><span>Avvik må kommenteres</span></div><span className="arr">→</span>
            <div className="node"><b>Regnskap</b><span>Bilagsmottak, bokføring og betaling</span></div>
          </div>
          <div className="grid3" style={{ marginTop: 24 }}>
            <div className="card"><h3>Mengdeavvik</h3><p>Fakturert mer enn mottatt, varer som ikke ble bestilt, eller varer som mangler på fakturaen.</p></div>
            <div className="card"><h3>Prisavvik</h3><p>Pris per enhet sammenlignes med prisen i bestillingen. Avvik over 2 % markeres.</p></div>
            <div className="card"><h3>Sporbarhet</h3><p>Hvem som registrerte, godkjente og sendte – med tidspunkt og kommentar på hver faktura.</p></div>
          </div>
        </div>
      </section>

      <section id="whitelabel">
        <div className="wrap grid2">
          <div className="sec-head" style={{ marginBottom: 0 }}><span className="eyebrow">White label</span><h2>Deres logo. Deres farger. Powered by Restoq.</h2><p>Last opp logoen, så henter Restoq firmafargene fra den. Appen ser ut som stedets egen – de ansatte møter merkevaren de jobber for, hver dag.</p></div>
          <div className="wl" aria-hidden="true">
            {[["#10302a", "#e8a628", "Bistro Nord"], ["#2b1d3f", "#d65a8e", "Bar Luna"], ["#f1ece3", "#b4532a", "Café Sjø"]].map(([bg, ac, n]) => (
              <div className="ph" key={n}>
                <div className="h" style={{ background: bg, color: bg === "#f1ece3" ? "#141a18" : "#fff", borderBottom: `3px solid ${ac}` }}><i style={{ background: ac }} />{n}<small>powered by Restoq</small></div>
                <div className="b"><div style={{ width: "80%" }} /><div style={{ width: "55%" }} /><div style={{ width: "70%" }} /><div className="btnx" style={{ background: bg }} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap grid2" style={{ alignItems: "start" }}>
          <div>
            <div className="sec-head"><span className="eyebrow">Spørsmål og svar</span><h2>Det de fleste lurer på</h2></div>
          </div>
          <div>
            <details className="faq"><summary>Hvor lang tid tar det å komme i gang?</summary><p>Vi importerer varelisten fra leverandørfakturaene deres og legger inn leverandørene med leveringsdager. Deretter gjør dere første varetelling – da er forslagene i gang.</p></details>
            <details className="faq"><summary>Må vi koble til regnskapssystemet?</summary><p>Nei. Lager, bestilling, telling og svinn fungerer uten regnskapssystem. Koblingen til regnskap (i dag Tripletex) brukes for å sende godkjente fakturaer videre til bokføring og betaling.</p></details>
            <details className="faq"><summary>Fungerer det med EHF-fakturaer som allerede kommer til regnskapet?</summary><p>Ja. Restoq henter leverandørfakturaene fra regnskapssystemet og matcher dem mot bestilling og varemottak, så de ikke registreres to ganger.</p></details>
            <details className="faq"><summary>Hvilke enheter kan de ansatte bruke?</summary><p>Restoq kjører i nettleseren på nettbrett, mobil og PC. Ingen installasjon.</p></details>
            <details className="faq"><summary>Hvor lagres dataene?</summary><p>På servere i EU. Hver kunde har sine egne data, og bare innloggede brukere med tilgang til stedet ser dem.</p></details>
            <details className="faq"><summary>Hva koster det?</summary><p>Prisen avhenger av antall utsalgssteder og hvilke moduler dere bruker. Ta kontakt, så setter vi opp en demo.</p></details>
          </div>
        </div>
      </section>

      <section id="kontakt" className="dark">
        <div className="wrap grid2" style={{ alignItems: "start" }}>
          <div className="sec-head"><span className="eyebrow">Kontakt</span><h2>Se Restoq med deres egne varer</h2><p>Fortell litt om stedet, så viser vi hvordan Restoq fungerer med deres leverandører og varer. Vi tar kontakt innen én virkedag.</p></div>
          <form className="box" action={leadAction} style={{ color: "var(--ink)" }}>
            {sp.takk ? <div className="note ok">Takk! Vi tar kontakt snart.</div> : null}
            {sp.feil === "mangler" ? <div className="note bad">Fyll inn navn og en gyldig e-postadresse.</div> : null}
            {sp.feil === "mange" ? <div className="note bad">For mange henvendelser på kort tid. Prøv igjen om litt.</div> : null}
            <div className="two"><label className="f">Navn<input name="name" required autoComplete="name" /></label><label className="f">Firma / sted<input name="company" autoComplete="organization" /></label></div>
            <div className="two"><label className="f">E-post<input name="email" type="email" required autoComplete="email" /></label><label className="f">Telefon<input name="phone" type="tel" autoComplete="tel" /></label></div>
            <label className="f">Antall utsalgssteder<select name="venues" defaultValue="1"><option value="1">1</option><option value="2–5">2–5</option><option value="6–20">6–20</option><option value="Flere enn 20">Flere enn 20</option></select></label>
            <label className="f">Melding<textarea name="message" rows={4} placeholder="F.eks. hvilke leverandører dere bruker og hva dere vil ha kontroll på" /></label>
            <div className="hp" aria-hidden="true"><label>Nettside<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            <button className="btn red" type="submit">Book en demo</button>
            <p className="small muted">Vi bruker opplysningene bare til å svare på henvendelsen. Les <Link href="/personvern">personvernerklæringen</Link>.</p>
          </form>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
