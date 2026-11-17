import { redirect } from "next/navigation";
import { changePasswordAction, logoutAction } from "../auth-actions";
import { SiteNav } from "../site-chrome";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Velg passord – Restoq", robots: { index: false } };

export default async function ChangePassword({ searchParams }: { searchParams: Promise<{ feil?: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const sp = await searchParams;
  return (
    <div className="site auth">
      <SiteNav links={false} />
      <main className="authbox">
        <h1>Velg eget passord</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Logget inn som {me.email}{me.org_name ? ` · ${me.org_name}` : ""}. Passordet må ha minst 10 tegn.</p>
        <form action={changePasswordAction} className="box">
          {sp.feil ? <div className="note bad">{sp.feil}</div> : null}
          <label className="f">Nytt passord<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
          <label className="f">Gjenta passordet<input name="password2" type="password" required minLength={10} autoComplete="new-password" /></label>
          <button className="btn dark" type="submit">Lagre og fortsett</button>
        </form>
        <form action={logoutAction} style={{ marginTop: 12 }}><button className="btn line sm" type="submit">Logg ut</button></form>
      </main>
    </div>
  );
}
