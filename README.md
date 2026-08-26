# @pipeworx/open-contracting

Open Contracting MCP — international public procurement: government tenders and
contract awards published under the OCDS (Open Contracting Data Standard).
Mirrors bulk OCDS releases from 19 national and subnational publishers —
838,000+ contracting processes — refreshed weekly from the OCP Data Registry.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

- `oc_tender_search(query, country, status, category, min_value, days, limit)` —
  free-text search over tender title, buyer and description. See
  [Language matching](#language-matching) — the query works in English even
  where the data is not.
- `oc_recent(country, days, limit)` — newest releases first, the "what just came
  out" view.
- `oc_process_history(ocid)` — every release for one contracting process, in
  order, showing the tender → award → contract progression.
- `oc_coverage()` — per-country publisher, release and process counts, and
  latest-release freshness. Call it first to see what is actually there.

## Auth

None for the caller. The pack is `injectSupabase` — it reads the OCDS bulk
publications over PostgREST, so a query resolves against one backing store
rather than depending on 19 separate upstream APIs being up at once.

Keep the wording here descriptive of WHAT is returned, not of where it is
served from: `pnpm check:hosting-claims` fails the build on published copy that
tells callers we hold a copy of upstream data, and this file is published (it
generates `docs/reference/open-contracting/`). That gate red-lined main for nine
consecutive pushes on 2026-08-23.

## Language matching

**Only 7 of the 19 publishers file their tender text in English.** The rest
publish in their own language, and the tool description and `country` argument
are both in English, so an English question used to hit a silent zero:
`{"query":"Ministry of Health","country":"Dominican Republic"}` returned 0 of
40,740 processes, while `"Ministerio de Salud"` returned rows.

| Language | Publishers |
|---|---|
| Spanish | Dominican Republic, Peru, Uruguay, Honduras, Guatemala, Mexico (Oaxaca), Argentina (Mendoza) |
| Albanian | Albania, Kosovo |
| Croatian | Croatia |
| Italian | Italy (ANAC) |
| Thai | Thailand (Bangkok) |
| English | Kenya, Nigeria, Ghana, Zambia, Liberia, Rwanda, Tanzania |

`oc_tender_search` now expands the query instead of translating it. The phrase
you passed is always searched; alongside it go its equivalents in the language
of the `country` you filtered to, drawn from a synonym table of the buyer and
subject words these corpora actually use (ministry / ministerio / ministria /
ministarstvo / ministero / กระทรวง, and ~45 more). Every spelling rides in one
PostgREST `or=(...)`, which is a single SQL predicate — the branches union, so
a row matching several is still returned once and there is no second round trip.

Three properties worth knowing:

- **It expands, never replaces.** These corpora are mixed, not consistently one
  language, so rewriting the query one way would drop whatever is filed the
  other way. A native-language query keeps working and can only gain rows.
- **The lookup is bidirectional, which is also the accent fix.** A caller who
  types `Ministerio de Educacion` gets the stored `MINISTERIO DE EDUCACIÓN`,
  because the unaccented Spanish token resolves through the same table to the
  accented stored form. That keeps every pattern fully literal, so the trigram
  index still applies.
- **It says what it searched.** The response carries `query_match.searched` (the
  spellings) and `query_match.publisher_language`. A zero result returns a
  `hint` naming the publisher's language, rather than a bare `count: 0` that
  teaches the caller the data is absent when it is present.

`*` inside a spelling is the wildcard between words, so `ministerio*salud`
matches `MINISTERIO DE SALUD PÚBLICA`. Word order is tried both ways for
two-word phrases, since it flips between languages ("road construction" is
filed as "construcción de carreteras").

For an English publisher no vocabulary is substituted — only connector
tolerance and word order, so `Ministry Health` and `health ministry` both reach
`MINISTRY OF HEALTH`.

## Data sources

- OCP Data Registry (bulk OCDS downloads): https://data.open-contracting.org/
- Open Contracting Data Standard: https://standard.open-contracting.org/
- Publishers include Guatecompras (GT), OECE (PE), DGCP (DO), ARCE (UY), ONCAE
  (HN), ANAC (IT), Narodne Novine (HR), PPRC (XK), PPC (AL), BMA (TH), and the
  national procurement authorities of KE, NG, GH, ZM, LR, RW, TZ.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "open-contracting": {
      "url": "https://gateway.pipeworx.io/open-contracting/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/open-contracting/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Open Contracting data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
