// Set the app version everywhere it lives: package.json, package-lock.json,
// src-tauri/Cargo.toml, src-tauri/Cargo.lock and src-tauri/tauri.conf.json,
// and turn CHANGELOG.md's Unreleased section into the new version's section.
//   node scripts/bump-version.mjs 0.2.0
//   node scripts/bump-version.mjs patch|minor|major
//   node scripts/bump-version.mjs 0.2.0-rc.1   (a pre-release: the changelog stays as it is)
// From a pre-release, patch / minor / major release the version it was for (0.2.0-rc.1 → 0.2.0).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const current = pkg.version.replace(/-.*$/, "");
if (["patch", "minor", "major"].includes(arg) && current !== pkg.version) next = current;
else if (["patch", "minor", "major"].includes(arg)) {
  const [ma, mi, pa] = current.split(".").map(Number);
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

// CHANGELOG.md: the Unreleased notes become this version's section
const changelog = p("CHANGELOG.md");
// a pre-release ships the Unreleased notes as they are (release-notes.mjs falls back to them)
if (next !== pkg.version && !next.includes("-") && existsSync(changelog)) {
  const repo = "https://github.com/mscrnt/diablo-companion";
  const today = new Date().toISOString().slice(0, 10);
  let s = readFileSync(changelog, "utf8");
  if (!/^## \[Unreleased\]/m.test(s)) throw new Error("CHANGELOG.md: no ## [Unreleased] section");
  if (new RegExp(`^## \\[${next.replace(/\./g, "\\.")}\\]`, "m").test(s)) throw new Error(`CHANGELOG.md already has ${next}`);
  // compare with the last full release, not a release candidate in between
  const prev = s.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1] ?? current;
  s = s.replace(/^## \[Unreleased\]\r?\n/m, `## [Unreleased]\n\n## [${next}] - ${today}\n`);
  s = s.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/compare/v${prev}...v${next}`);
  writeFileSync(changelog, s);
}

console.log(`${pkg.version} -> ${next}`);
