import { query } from '../../db/pool.js';

/**
 * Yapısal veri raporu (son tarama): tür bazlı geçerlilik, en sık hatalar, sayfa listesi,
 * işaretlenmemiş içerik fırsatları ve site geneli öneriler (Organization / WebSite / Breadcrumb).
 */

const ORG_TYPES = /^(Organization|Corporation|LocalBusiness|OnlineBusiness|NGO|.*Store|.*Business|Restaurant|Hotel|Dentist|MedicalClinic|Physician|Attorney|LegalService|RealEstateAgent|ProfessionalService|HairSalon|BeautySalon)$/;

export async function schemaReport(domain) {
  const { rows: [audit] } = await query(
    `SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domain.id],
  );
  if (!audit) return { needsAudit: true };
  const { rows: pages } = await query(
    `SELECT url, title, depth, schema_types, schema_report FROM audit_pages
      WHERE audit_id = $1 AND status_code = 200 AND NOT noindex`,
    [audit.id],
  );
  // Bu özellikten önceki taramalarda rapor ve bağlantı grafiği yok: yeniden tarama gerekir
  const { rows: [links] } = await query('SELECT EXISTS (SELECT 1 FROM audit_links WHERE audit_id = $1) AS has', [audit.id]);
  const needsRecrawl = !links.has && !pages.some((p) => p.schema_report);

  const types = new Map();
  const messages = new Map();
  const hints = new Map();
  const problemPages = [];
  for (const p of pages) {
    const items = p.schema_report?.items || [];
    for (const it of items) {
      const t = types.get(it.type) || { type: it.type, pages: new Set(), errors: new Set(), warnings: new Set() };
      t.pages.add(p.url);
      if (it.errors.length) t.errors.add(p.url);
      if (it.warnings.length) t.warnings.add(p.url);
      types.set(it.type, t);
      for (const [kind, list] of [['error', it.errors], ['warning', it.warnings]]) {
        for (const msg of list) {
          const m = messages.get(msg) || { message: msg, kind, type: it.type, pages: 0, samples: [] };
          m.pages++;
          if (m.samples.length < 5) m.samples.push(p.url);
          messages.set(msg, m);
        }
      }
    }
    for (const h of p.schema_report?.hints || []) {
      const g = hints.get(h) || { type: h, pages: [] };
      g.pages.push({ url: p.url, title: p.title });
      hints.set(h, g);
    }
    const errors = items.reduce((s, i) => s + i.errors.length, 0);
    const warnings = items.reduce((s, i) => s + i.warnings.length, 0);
    if (errors || warnings) problemPages.push({ url: p.url, title: p.title, errors, warnings, items: items.filter((i) => i.errors.length || i.warnings.length) });
  }

  // Site geneli kontroller
  const home = pages.find((p) => p.depth === 0);
  const homeTypes = home?.schema_types || [];
  const site = [];
  if (home && !homeTypes.some((t) => ORG_TYPES.test(t))) site.push({ code: 'org_missing', url: home.url });
  if (home && !homeTypes.includes('WebSite')) site.push({ code: 'website_missing', url: home.url });
  const deep = pages.filter((p) => p.depth >= 2);
  const deepNoCrumb = deep.filter((p) => !(p.schema_types || []).includes('BreadcrumbList'));
  if (deep.length >= 5 && deepNoCrumb.length / deep.length > 0.5) site.push({ code: 'breadcrumb_sparse', pages: deepNoCrumb.length, total: deep.length });

  const withSchema = pages.filter((p) => p.schema_types?.length).length;
  return {
    needsRecrawl,
    auditId: audit.id,
    summary: {
      pages: pages.length,
      withSchema,
      coverage: pages.length ? withSchema / pages.length : 0,
      pagesWithErrors: problemPages.filter((p) => p.errors).length,
      pagesWithWarnings: problemPages.filter((p) => !p.errors && p.warnings).length,
      opportunities: [...hints.values()].reduce((s, h) => s + h.pages.length, 0),
    },
    types: [...types.values()]
      .map((t) => ({ type: t.type, pages: t.pages.size, withErrors: t.errors.size, withWarnings: t.warnings.size, valid: t.pages.size - t.errors.size }))
      .sort((a, b) => b.pages - a.pages),
    messages: [...messages.values()].sort((a, b) => (a.kind === b.kind ? b.pages - a.pages : a.kind === 'error' ? -1 : 1)).slice(0, 60),
    opportunities: [...hints.values()].map((h) => ({ type: h.type, count: h.pages.length, pages: h.pages.slice(0, 25) })).sort((a, b) => b.count - a.count),
    site,
    pages: problemPages.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings).slice(0, 200),
  };
}
