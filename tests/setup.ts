// vitest's setup file: point the name tables at the data read off this PC, then load them before
// any test file runs, so tables filled at import time (map places, Hordes offers) are there too.
//
// The wiring itself is in tables.ts, without this await, so it can also be imported where a top-level
// await isn't welcome.
import "./tables";
import { loadStaticData } from "../src/lib/names";

export { GAMEDATA, hasGameData } from "./tables";

await loadStaticData();
