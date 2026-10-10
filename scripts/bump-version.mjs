// Set the app version everywhere it lives: package.json, package-lock.json,
// src-tauri/Cargo.toml, src-tauri/Cargo.lock and src-tauri/tauri.conf.json.
//   node scripts/bump-version.mjs 0.2.0
//   node scripts/bump-version.mjs patch|minor|major
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (f) => join(root, f);
const pkg = JSON.parse(readFileSync(p("package.json"), "utf8"));

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/bump-version.mjs <x.y.z|patch|minor|major>");
  process.exit(1);
}
let next = arg.replace(/^v/, "");
if (["patch", "minor", "major"].includes(arg)) {
  const [ma, mi, pa] = pkg.version.split(".").map(Number);
  next = arg === "major" ? `${ma + 1}.0.0` : arg === "minor" ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error(`not a semver version: ${next}`);
  process.exit(1);
}

const edit = (file, re) => {
  const s = readFileSync(p(file), "utf8");
  if (!s.match(re)) throw new Error(`${file}: version not found`);
  writeFileSync(p(file), s.replace(re, `$1${next}$2`));
};

edit("package.json", /("version":\s*")[^"]+(")/);
// the root package appears twice in the lockfile: top level and packages[""]
edit("package-lock.json", /("name":\s*"d4-companion",\s*"version":\s*")[^"]+(")/g);
edit("src-tauri/Cargo.toml", /(\[package\][^\[]*?\nversion\s*=\s*")[^"]+(")/);
edit("src-tauri/Cargo.lock", /(\[\[package\]\]\r?\nname = "d4c"\r?\nversion = ")[^"]+(")/);
edit("src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/);

console.log(`${pkg.version} -> ${next}`);
