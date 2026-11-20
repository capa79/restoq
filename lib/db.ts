import { Pool } from "pg";
import { hashPassword, verifyPassword } from "./password";

// Én felles tilkoblingspool per serverprosess.
// DATABASE_URL settes i Render (Neon: bruk «pooled connection string» med sslmode=require).
declare global {
  // eslint-disable-next-line no-var
  var __restoqPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __restoqReady: Promise<void> | undefined;
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL mangler");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const parsed = new URL(url);
  const channelBinding = parsed.searchParams.get("channel_binding") === "require";
  parsed.searchParams.delete("channel_binding");
  console.log(`Database: kobler til ${parsed.hostname}${parsed.pathname}`);
  return new Pool({
    connectionString: parsed.toString(),
    enableChannelBinding: channelBinding,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: local ? undefined : { rejectUnauthorized: true },
  });
}

export function pool(): Pool {
  if (!globalThis.__restoqPool) globalThis.__restoqPool = makePool();
  return globalThis.__restoqPool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT REFERENCES orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  -- admin = Restoq (plattform), owner = kundens leder, staff = ansatt
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','owner','staff')),
  is_root BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  temp_password_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- plattform-admin kan åpne en kundes app; da står kunden her
  acting_org_id BIGINT REFERENCES orgs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
-- Appens data per kunde: tellinger, bestillinger, svinn og oppsett (config/settings, config/items, config/brand)
CREATE TABLE IF NOT EXISTS docs (
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  col TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, col, id)
);
-- Henvendelser fra kontaktskjemaet på forsiden
CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  venues TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Opplastede filer (fakturaer og pakksedler som PDF/bilde)
CREATE TABLE IF NOT EXISTS files (
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INT NOT NULL,
  data BYTEA NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);
-- Kobling til regnskapssystem (Tripletex). Tokenet lagres kryptert.
CREATE TABLE IF NOT EXISTS integrations (
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  secret TEXT NOT NULL,
  info JSONB NOT NULL DEFAULT '{}',
  session_token TEXT,
  session_expires DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, provider)
);
-- API-nøkler for andre systemer (skanning av fakturaer/pakksedler, EDI). Bare hash lagres.
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
-- Utviklerrollen (tildeles av admin). Utviklere uten kunde ser bare /utvikler.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_developer BOOLEAN NOT NULL DEFAULT FALSE;
-- Feillogg (server og nettleser). Ryddes etter 30 dager.
CREATE TABLE IF NOT EXISTS error_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('server','client')),
  message TEXT NOT NULL,
  stack TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  digest TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  org_id BIGINT,
  user_id BIGINT
);
CREATE INDEX IF NOT EXISTS error_log_at ON error_log(at DESC);
-- Tilbakemeldinger fra testerne (knappen «Gi tilbakemelding» i appen)
CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id BIGINT REFERENCES orgs(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'annet',
  message TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ny',
  priority TEXT NOT NULL DEFAULT '',
  dev_note TEXT NOT NULL DEFAULT '',
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL DEFAULT '',
  handled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at DESC);
CREATE TABLE IF NOT EXISTS feedback_images (
  id BIGSERIAL PRIMARY KEY,
  feedback_id BIGINT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_images_fb ON feedback_images(feedback_id);
-- Oversettelser: rettelser gjort på utviklersiden, og tekster som manglet oversettelse da de ble vist
ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_lang TEXT;
CREATE TABLE IF NOT EXISTS i18n_overrides (
  lang TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, source)
);
CREATE TABLE IF NOT EXISTS i18n_missing (
  lang TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  hits INT NOT NULL DEFAULT 1,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, source)
);
-- Henvendelser: status og notat fra adminsiden, og kunden som ble opprettet
ALTER TABLE leads ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
-- Whitelabel: egen side per sted (restoq.no/v/<slug>)
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS orgnr TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS audit (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT,
  org_id BIGINT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function init() {
  const p = pool();
  await p.query(SCHEMA);
  // Hovedadministrator for Restoq fra miljøvariabler
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD ?? "";
  if (email && pw.length >= 10) {
    const { rows } = await p.query("SELECT id, password_hash FROM users WHERE is_root", []);
    if (rows.length === 0) {
      await p.query(
        `INSERT INTO users (email, name, password_hash, role, is_root) VALUES ($1, 'Administrator', $2, 'admin', TRUE)
         ON CONFLICT (email) DO UPDATE SET role = 'admin', is_root = TRUE, password_hash = EXCLUDED.password_hash`,
        [email, await hashPassword(pw)]
      );
    } else if (!rows[0].password_hash || !(await verifyPassword(pw, rows[0].password_hash))) {
      await p.query("UPDATE users SET email = $2, password_hash = $3 WHERE id = $1", [rows[0].id, email, await hashPassword(pw)]);
      await p.query("DELETE FROM sessions WHERE user_id = $1", [rows[0].id]);
    }
  }
}

export async function db(): Promise<Pool> {
  if (!globalThis.__restoqReady) {
    globalThis.__restoqReady = init().catch((e) => {
      globalThis.__restoqReady = undefined;
      throw e;
    });
  }
  await globalThis.__restoqReady;
  return pool();
}

export async function audit(actor: string | null, action: string, detail = "", orgId: number | null = null) {
  try {
    const p = await db();
    await p.query("INSERT INTO audit (actor, org_id, action, detail) VALUES ($1, $2, $3, $4)", [actor, orgId, action, detail.slice(0, 500)]);
  } catch (e) {
    console.error("audit feilet", e);
  }
}
