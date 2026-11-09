'use strict';

// Register shop hostnames on this Vercel project. Wildcard DNS and TLS must
// still be configured once at the DNS provider/Vercel project level.
async function registerTenantDomain(slug) {
  const root = String(process.env.POS_ROOT_DOMAIN || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '');
  if (!root || root.endsWith('.vercel.app')) return { skipped: true };

  const token = String(process.env.VERCEL_API_TOKEN || '').trim();
  const projectId = String(process.env.VERCEL_PROJECT_ID || '').trim();
  const teamId = String(process.env.VERCEL_TEAM_ID || '').trim();
  if (!token || !projectId) {
    throw Object.assign(new Error('Automatic domain setup is not configured. Add VERCEL_API_TOKEN and VERCEL_PROJECT_ID to the Vercel project.'), { code: 'VERCEL_DOMAIN_CONFIG' });
  }

  const domain = `${slug}.${root}`;
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/domains`);
  if (teamId) url.searchParams.set('teamId', teamId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: domain })
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok || (response.status === 409 && /already|exists|assigned/i.test(JSON.stringify(result)))) return { domain };
  const message = result.error?.message || result.message || `Vercel domain registration failed (HTTP ${response.status})`;
  throw Object.assign(new Error(message), { code: 'VERCEL_DOMAIN_FAILED', status: response.status });
}

module.exports = { registerTenantDomain };
