// Load the app's TypeScript modules from a plain Node script, so the command-line extractor and
// the app run exactly the same code. Vite is already a devDependency, and its SSR module loader is
// all this needs: no build step, no extra tooling.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Load one or more TS modules by repo-relative path ("src/lib/gamedata/pipeline.ts").
 * Returns the modules plus a `close()` that must be called, or Node will not exit.
 */
export async function loadTs(...specs) {
  const server = await createServer({
    configFile: false,
    root: ROOT,
    appType: 'custom',
    logLevel: 'warn',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const mods = await Promise.all(specs.map((s) => server.ssrLoadModule('/' + s.replace(/\\/g, '/'))));
    return { mods, close: () => server.close() };
  } catch (e) {
    await server.close();
    throw e;
  }
}
