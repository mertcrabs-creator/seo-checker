/** Minimal, standarda (RFC 9309) uygun robots.txt ayrıştırıcı. */
export function parseRobots(text, agent = 'crseobot') {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (!line || idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap' && value) sitemaps.push(value);
    else if ((key === 'allow' || key === 'disallow') && current && value) {
      current.rules.push({ allow: key === 'allow', path: value, re: toRegex(value) });
    }
  }

  const group = groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a))) || groups.find((g) => g.agents.includes('*'));
  const rules = group?.rules || [];
  return {
    sitemaps,
    rules,
    blocksAll: !isAllowed(rules, '/'),
  };
}

function toRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** En uzun eşleşen kural kazanır; eşitlikte Allow öncelikli. */
export function isAllowed(rules, pathWithQuery) {
  let best = null;
  for (const rule of rules) {
    if (!rule.re.test(pathWithQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return !best || best.allow;
}
