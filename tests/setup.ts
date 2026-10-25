// vitest's setup file: point the name tables at the data read off this PC, then load them before
// any test file runs, so tables filled at import time (map places, Hordes offers) are there too.
//
// The wiring itself is in tables.ts, without this await: the dev runner injects that into every
// module of a dev script (scripts/dev/run.mjs), and esbuild makes an injected module a dependency
// of its own imports, so a top-level await in there would deadlock the graph.
import "./tables";
import { loadStaticData } from "../src/lib/names";

await loadStaticData();
