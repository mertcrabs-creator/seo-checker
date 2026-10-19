import { http } from './client';

/**
 * Uygulamadaki TÜM API uç noktaları burada tanımlanır. Bileşenler doğrudan
 * axios/fetch kullanmaz; sadece bu modülden fonksiyon çağırır.
 */
const data = (p) => p.then((r) => r.data);
const id = (v) => encodeURIComponent(v);

export const authApi = {
  config: () => data(http.get('/auth/config', { skipAuth: true })),
  login: (body) => data(http.post('/auth/login', body, { skipAuth: true, skipRefresh: true })),
  register: (body) => data(http.post('/auth/register', body, { skipAuth: true, skipRefresh: true })),
  logout: () => data(http.post('/auth/logout', null, { skipRefresh: true })),
  me: () => data(http.get('/auth/me')),
  changePassword: (body) => data(http.post('/auth/change-password', body)),
};

export const domainApi = {
  list: () => data(http.get('/domains')),
  get: (domainId) => data(http.get(`/domains/${id(domainId)}`)),
  create: (body) => data(http.post('/domains', body)),
  update: (domainId, body) => data(http.patch(`/domains/${id(domainId)}`, body)),
  remove: (domainId) => data(http.delete(`/domains/${id(domainId)}`)),
  sync: (domainId) => data(http.post(`/domains/${id(domainId)}/sync`)),

  performance: (domainId, params) => data(http.get(`/domains/${id(domainId)}/performance`, { params })),
  keywords: (domainId, params) => data(http.get(`/domains/${id(domainId)}/keywords`, { params })),
  keywordTrend: (domainId, params) => data(http.get(`/domains/${id(domainId)}/keywords/trend`, { params })),
  keywordInsight: (domainId, keyword) => data(http.get(`/domains/${id(domainId)}/keywords/insight`, { params: { query: keyword } })),
  serpCheck: (domainId, body) => data(http.post(`/domains/${id(domainId)}/keywords/serp-check`, body, { timeout: 90_000 })),
  serpChecks: (domainId, keyword) => data(http.get(`/domains/${id(domainId)}/keywords/serp-checks`, { params: { query: keyword } })),
  pages: (domainId, params) => data(http.get(`/domains/${id(domainId)}/pages`, { params })),
  breakdown: (domainId, params) => data(http.get(`/domains/${id(domainId)}/breakdown`, { params })),
  opportunities: (domainId, params) => data(http.get(`/domains/${id(domainId)}/opportunities`, { params })),
  contentGaps: (domainId) => data(http.get(`/domains/${id(domainId)}/opportunities/content-gaps`)),

  startAudit: (domainId) => data(http.post(`/domains/${id(domainId)}/audits`)),
  audits: (domainId) => data(http.get(`/domains/${id(domainId)}/audits`)),
  latestAudit: (domainId) => data(http.get(`/domains/${id(domainId)}/audits/latest`)),
  auditIssue: (domainId, auditId, code) =>
    data(http.get(`/domains/${id(domainId)}/audits/${id(auditId)}/issues/${id(code)}`)),

  runPagespeed: (domainId, body) => data(http.post(`/domains/${id(domainId)}/pagespeed`, body)),
  pagespeed: (domainId) => data(http.get(`/domains/${id(domainId)}/pagespeed`)),

  // Site içi analiz (Search Console gerektirmez, son taramadan üretilir)
  siteOverview: (domainId) => data(http.get(`/domains/${id(domainId)}/site/overview`)),
  siteKeywords: (domainId, params) => data(http.get(`/domains/${id(domainId)}/site/keywords`, { params })),
  siteKeywordPages: (domainId, keyword) => data(http.get(`/domains/${id(domainId)}/site/keywords/pages`, { params: { keyword } })),
  sitePages: (domainId, params) => data(http.get(`/domains/${id(domainId)}/site/pages`, { params })),
  sitePageDetail: (domainId, url) => data(http.get(`/domains/${id(domainId)}/site/pages/detail`, { params: { url } })),
  siteOpportunities: (domainId) => data(http.get(`/domains/${id(domainId)}/site/opportunities`)),
};

/** Lokasyon bazlı Google sıralamaları (DataForSEO) */
export const rankingApi = {
  // Search Console kaynaklı (ücretsiz)
  gscSummary: (domainId, params) => data(http.get(`/domains/${id(domainId)}/rankings/gsc/summary`, { params })),
  gscKeywords: (domainId, params) => data(http.get(`/domains/${id(domainId)}/rankings/gsc/keywords`, { params })),
  gscMatrix: (domainId, params) => data(http.get(`/domains/${id(domainId)}/rankings/gsc/matrix`, { params })),
  gscLookup: (domainId, keyword) => data(http.get(`/domains/${id(domainId)}/rankings/gsc/lookup`, { params: { keyword } })),
  saveLanguages: (domainId, languages) => data(http.patch(`/domains/${id(domainId)}/rankings/languages`, { languages })),
  // DataForSEO (ücretli, opsiyonel)
  config: (domainId) => data(http.get(`/domains/${id(domainId)}/rankings/config`)),
  saveConfig: (domainId, body) => data(http.patch(`/domains/${id(domainId)}/rankings/config`, body)),
  refresh: (domainId) => data(http.post(`/domains/${id(domainId)}/rankings/refresh`)),
  summary: (domainId) => data(http.get(`/domains/${id(domainId)}/rankings/summary`)),
  keywords: (domainId, params) => data(http.get(`/domains/${id(domainId)}/rankings/keywords`, { params })),
  matrix: (domainId, params) => data(http.get(`/domains/${id(domainId)}/rankings/matrix`, { params })),
  check: (domainId, keyword) => data(http.post(`/domains/${id(domainId)}/rankings/check`, { keyword })),
  checks: (domainId) => data(http.get(`/domains/${id(domainId)}/rankings/checks`)),
};

export const analyzeApi = {
  run: (body) => data(http.post('/analyze', body, { timeout: 60_000 })),
};

/** Backlink'ler (Bing Webmaster + Search Console CSV + elle ekleme, tarayıcıyla doğrulanır) */
export const backlinkApi = {
  summary: (domainId) => data(http.get(`/domains/${id(domainId)}/backlinks/summary`)),
  list: (domainId, params) => data(http.get(`/domains/${id(domainId)}/backlinks`, { params })),
  domains: (domainId, params) => data(http.get(`/domains/${id(domainId)}/backlinks/domains`, { params })),
  refresh: (domainId) => data(http.post(`/domains/${id(domainId)}/backlinks/refresh`)),
  importUrls: (domainId, body) => data(http.post(`/domains/${id(domainId)}/backlinks/import`, body)),
  remove: (domainId, backlinkId) => data(http.delete(`/domains/${id(domainId)}/backlinks/${id(backlinkId)}`)),
  disavow: (domainId) => data(http.get(`/domains/${id(domainId)}/backlinks/disavow.txt`, { responseType: 'blob' })),
};

/** Otomatik izleme uyarıları */
export const alertApi = {
  list: (params) => data(http.get('/alerts', { params })),
  read: (alertId) => data(http.post('/alerts/read', alertId ? { id: alertId } : {})),
};

/** Google indekslenme durumu (URL Inspection API) */
export const indexApi = {
  inspect: (domainId) => data(http.post(`/domains/${id(domainId)}/index/inspect`)),
  summary: (domainId) => data(http.get(`/domains/${id(domainId)}/index/summary`)),
  pages: (domainId, params) => data(http.get(`/domains/${id(domainId)}/index/pages`, { params })),
};

/** Site otoritesi: puan, bileşenler, öneriler, konu kümeleri */
export const authorityApi = {
  latest: (domainId) => data(http.get(`/domains/${id(domainId)}/authority`)),
  compute: (domainId) => data(http.post(`/domains/${id(domainId)}/authority/compute`, null, { timeout: 120_000 })),
};

/** Analiz derinleştirme: değişiklik takibi, içerik erimesi, CTR anomalisi, kümeler, iç linkler, yapısal veri, rakipler, loglar */
export const adminApi = {
  users: () => data(http.get('/admin/users')),
  createUser: (body) => data(http.post('/admin/users', body)),
  updateUser: (userId, body) => data(http.patch(`/admin/users/${id(userId)}`, body)),
  removeUser: (userId) => data(http.delete(`/admin/users/${id(userId)}`)),
};

export const insightApi = {
  changes: (domainId, params) => data(http.get(`/domains/${id(domainId)}/insights/changes`, { params })),
  watch: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/changes/watch`)),
  checkNow: (domainId) => data(http.post(`/domains/${id(domainId)}/insights/changes/check`)),
  decay: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/decay`)),
  decayQueries: (domainId, params) => data(http.get(`/domains/${id(domainId)}/insights/decay/queries`, { params, timeout: 90_000 })),
  ctr: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/ctr`)),
  clusters: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/clusters`)),
  links: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/links`)),
  schema: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/schema`)),
  annotations: (domainId, params) => data(http.get(`/domains/${id(domainId)}/insights/annotations`, { params })),
  addAnnotation: (domainId, body) => data(http.post(`/domains/${id(domainId)}/insights/annotations`, body)),
  removeAnnotation: (domainId, annotationId) => data(http.delete(`/domains/${id(domainId)}/insights/annotations/${id(annotationId)}`)),
  competitors: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/competitors`)),
  addCompetitor: (domainId, hostname) => data(http.post(`/domains/${id(domainId)}/insights/competitors`, { hostname })),
  recrawlCompetitor: (domainId, competitorId) => data(http.post(`/domains/${id(domainId)}/insights/competitors/${id(competitorId)}/crawl`)),
  removeCompetitor: (domainId, competitorId) => data(http.delete(`/domains/${id(domainId)}/insights/competitors/${id(competitorId)}`)),
  verifyLogIps: (domainId, ips) => data(http.post(`/domains/${id(domainId)}/insights/logs/verify`, { ips }, { timeout: 60_000 })),
  saveLog: (domainId, summary) => data(http.post(`/domains/${id(domainId)}/insights/logs`, summary, { timeout: 60_000 })),
  logs: (domainId, params) => data(http.get(`/domains/${id(domainId)}/insights/logs`, { params })),
  competitorChanges: (domainId, params) => data(http.get(`/domains/${id(domainId)}/insights/competitors/changes`, { params })),
  competitorIntel: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/competitors/intel`, { timeout: 90_000 })),
  crux: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/crux`, { timeout: 60_000 })),
  serp: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/serp`)),
  serpSuggestions: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/serp/suggestions`)),
  addSerpKeywords: (domainId, items) => data(http.post(`/domains/${id(domainId)}/insights/serp/keywords`, { items })),
  removeSerpKeyword: (domainId, trackId) => data(http.delete(`/domains/${id(domainId)}/insights/serp/keywords/${id(trackId)}`)),
  checkSerp: (domainId) => data(http.post(`/domains/${id(domainId)}/insights/serp/check`)),
  ideas: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/ideas`, { timeout: 90_000 })),
  briefs: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/briefs`)),
  createBrief: (domainId, body) => data(http.post(`/domains/${id(domainId)}/insights/briefs`, body)),
  brief: (domainId, briefId) => data(http.get(`/domains/${id(domainId)}/insights/briefs/${id(briefId)}`)),
  removeBrief: (domainId, briefId) => data(http.delete(`/domains/${id(domainId)}/insights/briefs/${id(briefId)}`)),
  removeLog: (domainId, logId) => data(http.delete(`/domains/${id(domainId)}/insights/logs/${id(logId)}`)),
  geo: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/geo`, { timeout: 90_000 })),
  schemaPlan: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/schema/plan`)),
  setSector: (domainId, businessType) => data(http.put(`/domains/${id(domainId)}/insights/schema/sector`, { businessType })),
  generateSchema: (domainId, body) => data(http.post(`/domains/${id(domainId)}/insights/schema/generate`, body, { timeout: 60_000 })),
  rankDrops: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/rank-drops`)),
  rankDropAnalyses: (domainId) => data(http.get(`/domains/${id(domainId)}/insights/rank-drops/analyses`)),
  createRankDropAnalysis: (domainId, body) => data(http.post(`/domains/${id(domainId)}/insights/rank-drops/analyses`, body)),
  rankDropAnalysis: (domainId, analysisId) => data(http.get(`/domains/${id(domainId)}/insights/rank-drops/analyses/${id(analysisId)}`)),
  removeRankDropAnalysis: (domainId, analysisId) => data(http.delete(`/domains/${id(domainId)}/insights/rank-drops/analyses/${id(analysisId)}`)),
};

export const keywordApi = {
  list: (params) => data(http.get('/keywords', { params })),
  overview: (params) => data(http.get('/keywords/overview', { params })),
};

export const integrationApi = {
  googleStatus: () => data(http.get('/integrations/google')),
  googleAuthUrl: () => data(http.post('/integrations/google/auth-url')),
  googleSites: () => data(http.get('/integrations/google/sites')),
  googleDisconnect: () => data(http.delete('/integrations/google')),
  serpapiStatus: () => data(http.get('/integrations/serpapi')),
};
