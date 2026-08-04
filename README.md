# mcp-open-contracting

Open Contracting MCP — international public procurement: government tenders

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `oc_tender_search` | Search international public procurement — government tenders, contract notices, and contract awards published under the OCDS Open Contracting Data Standard. Covers 18 national and subnational publishers across developing countries and Europe: Africa (Kenya, Nigeria, Ghana, Zambia, Liberia, Rwanda, Tanzania), Latin America (Uruguay, Honduras, Guatemala, Peru, Dominican Republic, Mexico/Oaxaca), the Balkans (Albania, Kosovo, Croatia), Thailand (Bangkok), and Italy (ANAC anti-corruption authority). Free-text query matches tender title, buyer (procuring government entity), and description. Filter by country, status (e.g. tender, award, complete), category (works \| goods \| services), min_value (tender value floor), and days (recently released). Returns one row per contracting process (latest release) with buyer, value, procurement method, deadlines, and award details when present. Data is a weekly-refreshed hosted mirror of official OCDS bulk publications (OCP Data Registry). Use oc_coverage first to see which countries have data and how fresh it is. |
| `oc_recent` | Most recently published government procurement releases — new tenders and fresh contract awards across all covered OCDS publishers (Kenya, Nigeria, Ghana, Zambia, Liberia, Rwanda, Tanzania, Uruguay, Honduras, Guatemala, Peru, Dominican Republic, Mexico/Oaxaca, Albania, Kosovo, Croatia, Thailand/Bangkok, Italy), newest first. Optionally filter to one country and adjust the lookback window. The "what public tenders just came out" view over the weekly-refreshed OCP Data Registry mirror. |
| `oc_process_history` | Full release history for a single contracting process, looked up by its OCID (Open Contracting ID, as returned by oc_tender_search / oc_recent). Returns every OCDS release in chronological order, showing the tender → award → contract progression: planning and tender notices, deadline changes, and the eventual award with supplier and amount. Use it to trace how a specific government tender played out. |
| `oc_coverage` | What open-contracting procurement data Pipeworx currently holds: per-country publisher name, release and contracting-process counts, and latest-release freshness. Call this first to learn which of the 18 covered countries (Albania, Croatia, Dominican Republic, Ghana, Guatemala, Honduras, Italy, Kenya, Kosovo, Liberia, Mexico/Oaxaca, Nigeria, Peru, Rwanda, Tanzania, Thailand/Bangkok, Uruguay, Zambia) have data, how much, and how current the weekly-refreshed mirror is before relying on it. |

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Open Contracting data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
