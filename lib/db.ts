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
