// Bundle a TS dev script with esbuild (shipped with vite) and run it in Node.
// Includes a tiny shim for Vite's eager `import.meta.glob("x.json", { eager: true })`.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [name, ...args] = process.argv.slice(2);
const out = join(here, ".out", name + ".mjs");

const viteGlobShim = {
  name: "vite-glob-shim",
  setup(b) {
    b.onLoad({ filter: /src[\\/].*\.tsx?$/ }, (a) => {
      let src = readFileSync(a.path, "utf8");
      src = src.replace(/import\.meta\.glob\(\s*"([^"]+)"\s*,\s*\{[^}]*eager:\s*true[^}]*\}\s*\)/g, (_m, rel) => {
        const file = resolve(dirname(a.path), rel);
        return existsSync(file) ? `({ ${JSON.stringify(rel)}: ${readFileSync(file, "utf8")} })` : "({})";
      });
      return { contents: src, loader: a.path.endsWith("x") ? "tsx" : "ts" };
    });
  },
};

await build({
  entryPoints: [join(here, name + ".ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  // onnxruntime-web ships its own prebuilt bundle and finds its wasm next to itself; sharp is a
  // native module (both only used by icon-eval)
  external: ["@tauri-apps/*", "onnxruntime-web", "onnxruntime-web/webgpu", "sharp"],
  logLevel: "error",
  plugins: [viteGlobShim],
  // the tables come from the game data extracted on this PC (data/gamedata or GAMEDATA_DIR), as in the tests
  inject: [join(here, "../../tests/setup.ts")],
  // same constant vite.config.ts defines for the app
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(here, "../../package.json"), "utf8")).version) },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
process.exit(spawnSync(process.execPath, [out, ...args], { stdio: "inherit" }).status ?? 1);
