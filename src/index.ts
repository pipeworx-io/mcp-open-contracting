interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * Open Contracting MCP — international public procurement: government tenders
 * and contract awards published under the OCDS (Open Contracting Data
 * Standard). Covers the OCP Data Registry —
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

import { expandQuery, emptyResultHint, safePattern, type QueryExpansion } from './lang.js';

// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Open Contracting');
}

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
      'Search international public procurement — government tenders, contract notices, and contract awards published under the OCDS Open Contracting Data Standard. Covers 18 national and subnational publishers across developing countries and Europe: Africa (Kenya, Nigeria, Ghana, Zambia, Liberia, Rwanda, Tanzania), Latin America (Uruguay, Honduras, Guatemala, Peru, Dominican Republic, Mexico/Oaxaca), the Balkans (Albania, Kosovo, Croatia), Thailand (Bangkok), and Italy (ANAC anti-corruption authority). Free-text query matches tender title, buyer (procuring government entity), and description, and works in English even though most publishers file their text in Spanish, Albanian, Croatian, Italian or Thai: the query is searched alongside its equivalents in the language of the country you filter to, so "Ministry of Health" also finds "MINISTERIO DE SALUD". The response echoes every spelling it searched in query_match. Filter by country, status (e.g. tender, award, complete), category (works | goods | services), min_value (tender value floor), and days (recently released). Returns one row per contracting process (latest release) with buyer, value, procurement method, deadlines, and award details when present. Data is refreshed weekly from official OCDS publications (OCP Data Registry). Use oc_coverage first to see which countries have data and how fresh it is.',
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
      'Most recently published government procurement releases — new tenders and fresh contract awards across all covered OCDS publishers (Kenya, Nigeria, Ghana, Zambia, Liberia, Rwanda, Tanzania, Uruguay, Honduras, Guatemala, Peru, Dominican Republic, Mexico/Oaxaca, Albania, Kosovo, Croatia, Thailand/Bangkok, Italy), newest first. Optionally filter to one country and adjust the lookback window. The "what public tenders just came out" view over the weekly-refreshed OCP Data Registry feed.',
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
      'Which open-contracting procurement data is currently available: per-country publisher name, release and contracting-process counts, and latest-release freshness. Call this first to learn which of the 18 covered countries (Albania, Croatia, Dominican Republic, Ghana, Guatemala, Honduras, Italy, Kenya, Kosovo, Liberia, Mexico/Oaxaca, Nigeria, Peru, Rwanda, Tanzania, Thailand/Bangkok, Uruguay, Zambia) have data, how much, and how current the data is before relying on it.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

interface SupabaseConfig {
  url: string;
  key: string;
}

async function pg<T>(cfg: SupabaseConfig, table: string, query: string): Promise<T> {
  const res = await pwFetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`data query ${table}: ${res.status} ${text}`);
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

// Resolves to the EXACT stored country value, which is also what tells the
// text search which language this publisher files in (see ./lang.ts).
function resolveCountry(input: string): string | null {
  const q = input.trim().replace(/\s*\(.*\)$/, '').toLowerCase();
  if (!q) return null;
  const alias = COUNTRY_ALIASES[q];
  if (alias) return alias;
  for (const c of COUNTRIES) {
    const lc = c.toLowerCase();
    if (lc === q || lc.startsWith(q)) return c;
  }
  return null;
}

function countryFilter(country: string): string {
  return `country=eq.${encodeURIComponent(country)}`;
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
//
// Every spelling worth trying rides in this ONE `or=(...)`, which is a single
// SQL predicate: the branches union rather than multiply, so a row matching
// several of them is still returned once, and there is no second round trip.
// See ./lang.ts for why the caller's English phrase alone is not enough.
const SEARCH_FIELDS = ['title', 'buyer', 'description'];

function textSearchFilter(q: string, country: string | null): { filter: string; expansion: QueryExpansion } {
  const expansion = expandQuery(q, country);
  // Patterns are already structurally safe — the literal went through
  // safePattern() in expandQuery and the variants come from a built-in table —
  // so only URL-encoding is left. `*` survives encodeURIComponent, which is
  // what makes it usable as the between-words wildcard.
  const branches = expansion.spellings.flatMap((pattern) =>
    SEARCH_FIELDS.map((f) => `${f}.ilike.*${encodeURIComponent(pattern)}*`),
  );
  return { filter: `or=(${branches.join(',')})`, expansion };
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
    source: `${r.publisher} — OCP Data Registry`,
  });
}

async function tenderSearch(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const parts: string[] = [];
  // Country first: it decides which language the free-text query expands into.
  const countryInput = String(args.country ?? '').trim();
  let country: string | null = null;
  if (countryInput) {
    country = resolveCountry(countryInput);
    if (!country) return unknownCountryError(countryInput);
    parts.push(countryFilter(country));
  }
  const query = String(args.query ?? '').trim();
  let expansion: QueryExpansion | null = null;
  if (query) {
    const text = textSearchFilter(query, country);
    parts.push(text.filter);
    expansion = text.expansion;
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
  // Echo what was actually searched. A caller who asked in English against a
  // Spanish publisher needs to see that we tried "Ministerio de Salud" too —
  // otherwise the result set is unattributable to the words they typed.
  const queryMatch = expansion
    ? compact({
        searched: expansion.spellings,
        publisher_language: expansion.language,
        note: expansion.note,
      })
    : undefined;
  if (deduped.length === 0 && expansion) {
    return {
      count: 0,
      processes: [],
      query_match: queryMatch,
      hint: emptyResultHint(expansion),
    };
  }
  return compact({
    count: deduped.length,
    processes: deduped.map(shapeRelease),
    query_match: queryMatch,
  });
}

async function recent(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const parts: string[] = [];
  const countryInput = String(args.country ?? '').trim();
  if (countryInput) {
    const country = resolveCountry(countryInput);
    if (!country) return unknownCountryError(countryInput);
    parts.push(countryFilter(country));
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
    source: `${rows[0].publisher} — OCP Data Registry`,
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
    note: 'Weekly-refreshed official OCDS publications from the OCP Data Registry. latest_release shows each publisher\'s freshest data.',
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const supabaseUrl = (args._supabaseUrl as string | undefined)?.trim();
  const supabaseKey = (args._supabaseKey as string | undefined)?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('open-contracting is not configured on this deployment — an operator must enable its data credentials. This is a setup problem, not your arguments.');
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
