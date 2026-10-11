// Print one version's section of CHANGELOG.md (used as the GitHub release notes).
//   node scripts/release-notes.mjs 0.1.1
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);
let start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
// a release candidate has no section of its own: it ships what's under Unreleased
const pre = version.includes("-");
if (start < 0 && pre) start = lines.findIndex((l) => l.startsWith("## [Unreleased]"));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && (l.startsWith("## [") || /^\[[^\]]+\]: /.test(l)));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) {
  console.error(`CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}
console.log(pre ? `**Release candidate for ${version.replace(/-.*$/, "")}**, for testing. The in-app updater doesn't offer it.\n\n${body}` : body);
