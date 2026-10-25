// The GameDataIO the command-line extractor uses: node fs for the files, cascx.exe for the
// read-only copies out of CASC. See src/lib/gamedata/io.ts for the contract.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Empty a directory of OUR output (never the game dir). Files are removed; directories that some
 *  other process (indexer, editor, AV) keeps open are left in place instead of failing the run. */
export function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      cleanDir(p);
      try {
        fs.rmdirSync(p);
      } catch {
        /* busy: keep empty dir */
      }
    } else fs.rmSync(p, { force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const dirSize = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0)
    : 0;

/**
 * @param {{ game: string, out: string, raw: string, vendor: string, cascx: string, quiet?: boolean }} opts
 */
export function nodeIo({ game, out, raw, vendor, cascx, quiet = false }) {
  const log = (...a) => quiet || console.log('[extract]', ...a);
  const guard = (root, rel) => {
    const p = path.resolve(root, rel);
    if (p !== path.resolve(root) && !p.startsWith(path.resolve(root) + path.sep)) throw new Error('path escapes ' + root + ': ' + rel);
    return p;
  };
  const rawPath = (rel) => guard(raw, rel);
  const outPath = (rel) => guard(out, rel);

  const cascRun = (args) => {
    try {
      execFileSync(cascx, [game, ...args], {
        stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'pipe'],
        maxBuffer: 1 << 28,
        windowsHide: true,
      });
      return { failed: 0 };
    } catch (e) {
      // exit code 3 = some files failed (normally encrypted files whose TACT key is not available)
      const err = String(e.stderr || '');
      const m = err.match(/matched=(\d+) extracted=(\d+) failed=(\d+)/);
      if (e.status === 3 && m) return { matched: +m[1], extracted: +m[2], failed: +m[3] };
      process.stderr.write(err);
      throw e;
    }
  };

  return {
    async read(rel) {
      const p = rawPath(rel);
      try {
        return fs.readFileSync(p);
      } catch {
        return null;
      }
    },
    async readMany(rels) {
      return rels.map((rel) => {
        try {
          return fs.readFileSync(rawPath(rel));
        } catch {
          return null;
        }
      });
    },
    async list(rel) {
      try {
        return fs.readdirSync(rawPath(rel), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
      } catch {
        return [];
      }
    },
    async vendor(rel) {
      return fs.readFileSync(path.join(vendor, rel), 'utf8');
    },
    async write(rel, text) {
      const p = outPath(rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    },
    async readOut(rel) {
      try {
        return fs.readFileSync(outPath(rel), 'utf8');
      } catch {
        return null;
      }
    },
    async clean(rel) {
      cleanDir(outPath(rel));
    },
    async cleanRaw() {
      cleanDir(raw);
      fs.mkdirSync(raw, { recursive: true });
    },
    async casc(names, mode) {
      if (!fs.existsSync(cascx)) throw new Error(`cascx.exe not found at ${cascx}: build it with tools/datamine/build-cascx.mjs`);
      fs.mkdirSync(raw, { recursive: true });
      if (mode === 'mask') return cascRun(['extract', raw, ...names]);
      const listFile = path.join(raw, 'casc-list.txt');
      fs.writeFileSync(listFile, names.join('\n'));
      return cascRun(['extract-list', raw, listFile]);
    },
    async rawBytes() {
      return dirSize(raw);
    },
    progress({ stage, done, total }) {
      log(stage + (total ? ` ${done ?? 0}/${total}` : '') + ' ...');
    },
    async tick() {
      /* nothing to yield to in a one-shot script */
    },
  };
}
