import { importMobalytics } from "../../src/lib/mobalytics";
import { loadStaticData } from "../../src/lib/names";
await loadStaticData();
for (const u of ["https://mobalytics.gg/diablo-4/profile/fervorgaming/builds/my-build", "https://mobalytics.gg/diablo-4/builds/bloodwave-necomancer-build-fervor"]) {
  try {
    const { build, via } = await importMobalytics(u, { prefer: "fast" });
    console.log("OK", via, "|", build.name, "|", build.className, build.season, "| variants", build.variants.length, "| gear", build.variants[0]?.gear.length);
  } catch (e) { console.log("FAIL", u, String(e).slice(0, 300)); }
}
