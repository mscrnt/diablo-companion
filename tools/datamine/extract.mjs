#!/usr/bin/env node
// Diablo IV game-data extraction for diablo-companion, from the command line.
//
//   node tools/datamine/extract.mjs [--game "G:\Blizzard\Diablo IV"] [--out <dir>] [--raw <dir>]
//                                   [--skip-casc] [--keep-raw] [--only-app]
//
// This is only a host: the reading and parsing live in src/lib/gamedata/*.ts, which the app's Web
// Worker runs too, so there is a single implementation. Here it writes data/gamedata/* (the shapes
// data/gamedata/README.md documents) and the small src/generated-style tables under
// data/gamedata/generated/.
//
// All reads of the game install are strictly read-only, through tools/datamine/bin/cascx.exe (our
// CascLib wrapper, which strips write access from every file handle CascLib opens).

import fs from 'node:fs';
import path from 'node:path';
import { loadTs, ROOT } from './tsload.mjs';
import { nodeIo } from './nodeIo.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);

const GAME = opt('--game', process.env.D4_GAME_DIR || 'G:\\Blizzard\\Diablo IV');
const OUT = path.resolve(opt('--out', path.join(ROOT, 'data', 'gamedata')));
const RAW = path.resolve(opt('--raw', path.join(OUT, 'raw')));
const VENDOR = path.join(ROOT, 'src-tauri', 'resources', 'd4data');
const CASCX = process.env.D4C_CASCX || path.join(ROOT, 'tools', 'datamine', 'bin', 'cascx.exe');

async function main() {
  const { mods, close } = await loadTs('src/lib/gamedata/io.ts', 'src/lib/gamedata/pipeline.ts');
  const [{ parseBuildInfo }, { run }] = mods;
  try {
    const build = parseBuildInfo(fs.readFileSync(path.join(GAME, '.build.info'), 'utf8'));
    console.log('[extract] game build', build.version, 'at', GAME);
    const io = nodeIo({ game: GAME, out: OUT, raw: RAW, vendor: VENDOR, cascx: CASCX });
    // --only-app writes just what the app reads back, like the in-app reader does
    const keep = flag('--only-app') ? (rel) => !rel.startsWith('strings/') && rel !== 'gbid.json' && rel !== 'world.json' && rel !== 'monsters.json' : () => true;
    const t0 = Date.now();
    const { manifest } = await run({ io, build, skipCasc: flag('--skip-casc'), keep, dropRaw: !flag('--keep-raw') && !flag('--skip-casc') });
    console.log('[extract] done in', Math.round((Date.now() - t0) / 1000), 's ->', OUT);
    console.log('[extract]', JSON.stringify(manifest.counts));
    if (manifest.parseErrors) console.log('[extract]', manifest.parseErrors, 'parse errors (see parse-errors.txt)');
  } finally {
    await close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[extract]', e);
    process.exit(1);
  },
);
