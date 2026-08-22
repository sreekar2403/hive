**Type:** wayfinder:task
**Blocked by:** 021
**Blocks:** none

## Question

`packages/server/src/index.ts` calls `createDefaultConfig()` and never reads `hive.config.json` from
disk at all — the root config file is currently pure decoration. Wire real loading once 021 has decided
the final shape of config (since category→model/provider routing is being added to it, the shape isn't
just today's flat `Config` interface anymore). Decide precedence if both the legacy `hive.config.json`
fields and the new category-routing settings need to coexist, and where defaults come from when a field
is missing.
