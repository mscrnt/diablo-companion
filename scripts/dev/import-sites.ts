// Checks the paste-only importers against real links, the way a player pastes them.
// Prints a summary only: no response from any site is written to disk.
//
//   node scripts/dev/run.mjs import-sites [url ...]
import { importBuild, SITE_LABEL, siteOf } from "../../src/lib/importers";
import { loadStaticData } from "../../src/lib/names";

const urls = process.argv.slice(2);
if (!urls.length) {
  console.log("Pass one build link per site, e.g.\n  node scripts/dev/run.mjs import-sites <maxroll url> <icy-veins url> <d4builds url>");
  process.exit(1);
}

await loadStaticData();
for (const u of urls) {
  const site = siteOf(u);
  try {
    const { build, defaultVariant } = await importBuild(u, { prefer: "fast" });
    const v = build.variants.find((x) => x.id === defaultVariant) ?? build.variants[0];
    console.log(`OK  ${SITE_LABEL[build.source]} | ${build.name} | ${build.className} ${build.season} | ${build.variants.length} variant(s): ${build.variants.map((x) => x.name).join(", ")}`);
    console.log(`    variant "${v?.name}": ${v?.gear.length} slots, ${v?.gear.reduce((n, g) => n + g.affixes.length, 0)} affixes, ${v?.gear.reduce((n, g) => n + g.sockets.length, 0)} sockets, ${v?.skillBar.length} bar skills, ${v?.paragon.length} boards, ${v?.sections.length + build.sections.length} notes`);
    for (const g of v?.gear.slice(0, 6) ?? [])
      console.log(`    ${g.slotLabel.padEnd(18)} ${g.itemName || "(not named)"} [${g.kind}] ${g.affixes.map((a) => a.name).join(", ")}${g.sockets.length ? " · " + g.sockets.map((s) => s.name).join(" + ") : ""}`);
    for (const p of v?.paragon.slice(0, 3) ?? []) console.log(`    board ${p.name} / glyph ${p.glyphName} lvl ${p.glyphLevel} (${p.nodes.length} nodes)`);
    console.log(`    mercs: ${JSON.stringify(v?.mercenary)}`);
  } catch (e) {
    console.log(`FAIL ${site ? SITE_LABEL[site] : "?"} ${u}\n     ${String((e as Error).message ?? e).slice(0, 400)}`);
  }
}
