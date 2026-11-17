// E-post fra Restoq, sendt med Resend over HTTPS (Render blokkerer SMTP på gratisnivået).
//   RESEND_API_KEY  API-nøkkel fra resend.com
//   MAIL_FROM       f.eks. «Restoq <post@restoq.no>». Domenet må være bekreftet hos Resend.
// Uten oppsett sendes ingen e-post; midlertidige passord vises da på skjermen i stedet.
export const mailEnabled = () => Boolean(process.env.RESEND_API_KEY && (process.env.MAIL_FROM ?? "").trim());
export const appUrl = () => (process.env.APP_URL ?? "https://restoq.no").replace(/\/+$/, "");

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [to],
        subject,
        text,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(text)}</div>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error("Resend avviste e-post", res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error("E-post feilet", e);
    return false;
  }
}
