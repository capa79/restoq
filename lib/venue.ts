import { cache } from "react";
import { db } from "./db";
import { getBrand, type Brand } from "./brand";

export type Venue = { id: number; name: string; slug: string; website: string; brand: Brand; hasHero: boolean };

/** Stedet bak restoq.no/v/<slug>, med whitelabel-profilen. */
export const getVenue = cache(async (slug: string): Promise<Venue | null> => {
  if (!/^[a-z0-9-]{1,48}$/.test(slug)) return null;
  const p = await db();
  const o = (await p.query("SELECT o.id, o.name, o.slug, o.website, EXISTS (SELECT 1 FROM files f WHERE f.org_id = o.id AND f.id = 'brand-hero') AS hero FROM orgs o WHERE o.slug = $1", [slug])).rows[0];
  if (!o) return null;
  const brand = await getBrand(Number(o.id));
  return { id: Number(o.id), name: brand.name || o.name, slug: o.slug, website: o.website, brand, hasHero: o.hero };
});
