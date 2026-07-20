interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Open Contracting MCP — international public procurement: government tenders
 * and contract awards published under the OCDS (Open Contracting Data
 * Standard). Queries the Pipeworx-hosted mirror of the OCP Data Registry —
 * bulk OCDS releases from 13 national/subnational publishers, refreshed
 * weekly — via PostgREST.
 *
 * Coverage: Africa (Kenya, Nigeria, Ghana, Zambia, Liberia), Latin America
 * (Uruguay, Honduras, Mexico/Oaxaca), the Balkans (Albania, Kosovo, Croatia),
 * Thailand (Bangkok), and Italy (ANAC). The default read surface is the
 * ocds_latest view (one row per contracting process); oc_process_history
 * reads the full ocds_releases table to show tender → award progression.
 *
 * The pack is stateless (gateway handles auth/rate-limit) and never throws
 * for expected empty results — it shapes LLM-friendly objects and returns
 * { error }.
 */


// Exact stored country values in the mirror (ocds_latest.country).
// Exact `country` values as stored by the two loaders (worker
// datasets/ocds.ts + scripts/ocds-heavy-upsert.sh). Keep in sync when adding
// publishers. Must be eq-filters: country has a btree (country, release_date)
// index; an ilike here forces a 17s+ unindexed scan.
const COUNTRIES = [
  'Albania', 'Argentina', 'Croatia', 'Dominican Republic', 'Ghana',
  'Guatemala', 'Honduras', 'Italy', 'Kenya', 'Kosovo', 'Liberia', 'Mexico',
  'Nigeria', 'Peru', 'Rwanda', 'Tanzania', 'Thailand', 'Uruguay', 'Zambia',
] as const;

// City/region aliases → stored country values.
const COUNTRY_ALIASES: Record<string, string> = {
  bangkok: 'Thailand', oaxaca: 'Mexico', anac: 'Italy', mendoza: 'Argentina',
  'dominican rep': 'Dominican Republic', dr: 'Dominican Republic',
  guatecompras: 'Guatemala', oece: 'Peru',
};

const CATEGORIES = ['works', 'goods', 'services'] as const;

const tools: McpToolExport['tools'] = [
  {
    name: 'oc_tender_search',
    description:
      'Search international public procurement — government tenders, contract notices, and contract awards published under the OCDS Open Contracting Data Standard. Covers 18 national and subnational publishers across developing countries and Europe: Africa (Kenya, Nigeria, Ghana, Zambia, Liberia, Rwanda, Tanzania), Latin America (Uruguay, Honduras, Guatemala, Peru, Dominican Republic, Mexico/Oaxaca), the Balkans (Albania, Kosovo, Croatia), Thailand (Bangkok), and Italy (ANAC anti-corruption authority). Free-text query matches tender title, buyer (procuring government entity), and description. Filter by country, status (e.g. tender, award, complete), category (works | goods | services), min_value (tender value floor), and days (recently released). Returns one row per contracting process (latest release) with buyer, value, procurement method, deadlines, and award details when present. Data is a weekly-refreshed hosted mirror of official OCDS bulk publications (OCP Data Registry). Use oc_coverage first to see which countries have data and how fresh it is.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text matched (case-insensitive) against tender title, buyer, and description, e.g. "road construction", "medical supplies", "ministry of health".' },
        country: { type: 'string', description: `Country name, forgiving match (e.g. "Thailand", "mexico", "kosovo"). One of: ${COUNTRIES.join(' | ')}.` },
        status: { type: 'string', description: 'Contracting process status, e.g. "tender", "award", "complete".' },
        category: { type: 'string', description: `Main procurement category. One of: ${CATEGORIES.join(' | ')}.` },
        min_value: { type: ['number', 'string'], description: 'Only processes whose tender value is at or above this (in the publisher\'s currency).' },
        days: { type: ['number', 'string'], description: 'Only releases published within this many days.' },
        limit: { type: ['number', 'string'], description: 'Max results (1-100, default 20).' },
      },
      required: [],
    },
  },
  {
    name: 'oc_recent',
    description:
      'Most recently published government procurement releases — new tenders and fresh contract awards across all covered OCDS publishers (Kenya, Nigeria, Ghana, Zambia, Liberia, Rwanda, Tanzania, Uruguay, Honduras, Guatemala, Peru, Dominican Republic, Mexico/Oaxaca, Albania, Kosovo, Croatia, Thailand/Bangkok, Italy), newest first. Optionally filter to one country and adjust the lookback window. The "what public tenders just came out" view over the weekly-refreshed OCP Data Registry mirror.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: `Country name, forgiving match. One of: ${COUNTRIES.join(' | ')}.` },
        days: { type: ['number', 'string'], description: 'Lookback window in days (default 14).' },
        limit: { type: ['number', 'string'], description: 'Max results (1-100, default 20).' },
      },
      required: [],
    },
  },
  {
    name: 'oc_process_history',
    description:
      'Full release history for a single contracting process, looked up by its OCID (Open Contracting ID, as returned by oc_tender_search / oc_recent). Returns every OCDS release in chronological order, showing the tender → award → contract progression: planning and tender notices, deadline changes, and the eventual award with supplier and amount. Use it to trace how a specific government tender played out.',
    inputSchema: {
      type: 'object',
      properties: {
        ocid: { type: 'string', description: 'The Open Contracting ID of the process, e.g. "ocds-abc123-000-00001".' },
      },
      required: ['ocid'],
    },
  },
  {
    name: 'oc_coverage',
    description:
      'What open-contracting procurement data Pipeworx currently holds: per-country publisher name, release and contracting-process counts, and latest-release freshness. Call this first to learn which of the 18 covered countries (Albania, Croatia, Dominican Republic, Ghana, Guatemala, Honduras, Italy, Kenya, Kosovo, Liberia, Mexico/Oaxaca, Nigeria, Peru, Rwanda, Tanzania, Thailand/Bangkok, Uruguay, Zambia) have data, how much, and how current the weekly-refreshed mirror is before relying on it.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

interface SupabaseConfig {
  url: string;
  key: string;
}

async function pg<T>(cfg: SupabaseConfig, table: string, query: string): Promise<T> {
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${table}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}

// Forgiving country resolution to an EXACT stored value (indexed eq filter):
// case-insensitive, parentheticals stripped, aliases ("bangkok") mapped.
// Rows come ordered release_date desc — first row per process wins.
function dedupeLatest(rows: ReleaseRow[]): ReleaseRow[] {
  const seen = new Set<string>();
  const out: ReleaseRow[] = [];
  for (const r of rows) {
    const key = `${r.source_id}|${r.ocid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function countryFilter(input: string): string | null {
  const q = input.trim().replace(/\s*\(.*\)$/, '').toLowerCase();
  if (!q) return null;
  const alias = COUNTRY_ALIASES[q];
  if (alias) return `country=eq.${encodeURIComponent(alias)}`;
  for (const c of COUNTRIES) {
    const lc = c.toLowerCase();
    if (lc === q || lc.startsWith(q)) return `country=eq.${encodeURIComponent(c)}`;
  }
  return null;
}

function unknownCountryError(input: string) {
  return {
    error: 'unknown_country',
    message: `No covered publisher matches "${input}".`,
    retry_hint: `Pass one of: ${COUNTRIES.join(', ')} — or call oc_coverage to see what data is available.`,
  };
}

// Free-text match across title/buyer/description via a PostgREST `or=` logic
// tree. Values inside or=(...) share the tree's syntax, so characters that
// PostgREST parses structurally (commas, parens, quotes, backslashes) are
// stripped from the user text before the value is URL-encoded — same
// encode-the-value approach as the sibling packs' single ilike filters.
function textSearchFilter(q: string): string {
  const safe = encodeURIComponent(q.replace(/[,()"\\]/g, ' ').replace(/\s+/g, ' ').trim());
  const fields = ['title', 'buyer', 'description'];
  return `or=(${fields.map((f) => `${f}.ilike.*${safe}*`).join(',')})`;
}

interface ReleaseRow {
  source_id: string;
  country: string;
  publisher: string;
  ocid: string;
  release_id: string;
  release_date: string | null;
  tags: string[] | null;
  title: string | null;
  description: string | null;
  buyer: string | null;
  status: string | null;
  category: string | null;
  procurement_method: string | null;
  value_amount: number | null;
  value_currency: string | null;
  tender_deadline: string | null;
  award_date: string | null;
  award_amount: number | null;
  award_currency: string | null;
  award_supplier: string | null;
  updated_at: string | null;
}

const RELEASE_SELECT =
  'select=source_id,country,publisher,ocid,release_id,release_date,tags,title,description,buyer,status,category,procurement_method,value_amount,value_currency,tender_deadline,award_date,award_amount,award_currency,award_supplier';

// Compact row shaping: drop null/empty fields so LLM output stays small.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function shapeRelease(r: ReleaseRow) {
  return compact({
    ocid: r.ocid,
    country: r.country,
    title: r.title,
    description: r.description && r.description.length > 300 ? `${r.description.slice(0, 300)}…` : r.description,
    buyer: r.buyer,
    status: r.status,
    category: r.category,
    procurement_method: r.procurement_method,
    value_amount: r.value_amount,
    value_currency: r.value_currency,
    tender_deadline: r.tender_deadline,
    award_date: r.award_date,
    award_amount: r.award_amount,
    award_currency: r.award_currency,
    award_supplier: r.award_supplier,
    release_date: r.release_date,
    source: `${r.publisher} — OCP Data Registry mirror hosted by Pipeworx`,
  });
}

async function tenderSearch(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const parts: string[] = [];
  const query = String(args.query ?? '').trim();
  if (query) parts.push(textSearchFilter(query));
  const countryInput = String(args.country ?? '').trim();
  if (countryInput) {
    const country = countryFilter(countryInput);
    if (!country) return unknownCountryError(countryInput);
    parts.push(country);
  }
  const status = String(args.status ?? '').trim();
  if (status) parts.push(`status=eq.${encodeURIComponent(status.toLowerCase())}`);
  const category = String(args.category ?? '').trim();
  if (category) parts.push(`category=eq.${encodeURIComponent(category.toLowerCase())}`);
  if (args.min_value !== undefined && String(args.min_value).trim() !== '') {
    parts.push(`value_amount=gte.${Number(args.min_value)}`);
  }
  if (args.days !== undefined && String(args.days).trim() !== '') {
    const since = new Date(Date.now() - Number(args.days) * 86_400_000).toISOString();
    parts.push(`release_date=gte.${since}`);
  }
  const limit = clampInt(args.limit, 1, 100, 20);
  // Query the base table, not the ocds_latest view: DISTINCT ON in the view
  // materializes all 400k+ rows before filtering (20s). The table path uses
  // the (country, release_date) and trgm indexes; rows arrive newest-first,
  // so keeping the first row per process is the latest release.
  parts.push(RELEASE_SELECT, 'order=release_date.desc.nullslast', `limit=${Math.min(limit * 3, 300)}`);
  const rows = await pg<ReleaseRow[]>(cfg, 'ocds_releases', parts.join('&'));
  const deduped = dedupeLatest(rows).slice(0, limit);
  return { count: deduped.length, processes: deduped.map(shapeRelease) };
}

async function recent(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const parts: string[] = [];
  const countryInput = String(args.country ?? '').trim();
  if (countryInput) {
    const country = countryFilter(countryInput);
    if (!country) return unknownCountryError(countryInput);
    parts.push(country);
  }
  const days = clampInt(args.days, 1, 365, 14);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  parts.push(`release_date=gte.${since}`);
  const limit = clampInt(args.limit, 1, 100, 20);
  parts.push(RELEASE_SELECT, 'order=release_date.desc.nullslast', `limit=${Math.min(limit * 3, 300)}`);
  const rows = await pg<ReleaseRow[]>(cfg, 'ocds_releases', parts.join('&'));
  const deduped = dedupeLatest(rows).slice(0, limit);
  return { days, count: deduped.length, processes: deduped.map(shapeRelease) };
}

async function processHistory(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const ocid = String(args.ocid ?? '').trim();
  if (!ocid) {
    return { error: 'missing_args', message: 'Provide an ocid (as returned by oc_tender_search or oc_recent).' };
  }
  const parts = [
    `ocid=eq.${encodeURIComponent(ocid)}`,
    RELEASE_SELECT,
    'order=release_date.asc.nullslast',
    'limit=100',
  ];
  const rows = await pg<ReleaseRow[]>(cfg, 'ocds_releases', parts.join('&'));
  if (rows.length === 0) {
    return {
      error: 'not_found',
      message: `No releases for ocid "${ocid}".`,
      retry_hint: 'Use the ocid exactly as returned by oc_tender_search or oc_recent.',
    };
  }
  return {
    ocid,
    country: rows[0].country,
    publisher: rows[0].publisher,
    release_count: rows.length,
    releases: rows.map((r) =>
      compact({
        release_id: r.release_id,
        release_date: r.release_date,
        tags: r.tags,
        title: r.title,
        buyer: r.buyer,
        status: r.status,
        category: r.category,
        procurement_method: r.procurement_method,
        value_amount: r.value_amount,
        value_currency: r.value_currency,
        tender_deadline: r.tender_deadline,
        award_date: r.award_date,
        award_amount: r.award_amount,
        award_currency: r.award_currency,
        award_supplier: r.award_supplier,
      }),
    ),
    source: `${rows[0].publisher} — OCP Data Registry mirror hosted by Pipeworx`,
  };
}

interface CoverageRow {
  source_id: string;
  country: string;
  publisher: string;
  releases: number;
  processes: number;
  latest_release: string | null;
}

async function coverage(cfg: SupabaseConfig) {
  const rows = await pg<CoverageRow[]>(
    cfg,
    'ocds_coverage_cached',
    'select=source_id,country,publisher,releases,processes,latest_release&order=country.asc',
  );
  return {
    countries: rows.length,
    total_processes: rows.reduce((s, r) => s + Number(r.processes ?? 0), 0),
    total_releases: rows.reduce((s, r) => s + Number(r.releases ?? 0), 0),
    sources: rows.map((r) =>
      compact({
        country: r.country,
        publisher: r.publisher,
        processes: Number(r.processes ?? 0),
        releases: Number(r.releases ?? 0),
        latest_release: r.latest_release,
      }),
    ),
    note: 'Weekly-refreshed mirror of official OCDS bulk publications from the OCP Data Registry, hosted by Pipeworx. latest_release shows each publisher\'s freshest data.',
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const supabaseUrl = (args._supabaseUrl as string | undefined)?.trim();
  const supabaseKey = (args._supabaseKey as string | undefined)?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('open-contracting pack requires platform Supabase credentials (operator-configured).');
  }
  const cfg: SupabaseConfig = { url: supabaseUrl, key: supabaseKey };

  switch (name) {
    case 'oc_tender_search':
      return tenderSearch(cfg, args);
    case 'oc_recent':
      return recent(cfg, args);
    case 'oc_process_history':
      return processHistory(cfg, args);
    case 'oc_coverage':
      return coverage(cfg);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
