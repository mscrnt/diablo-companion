import { loadStaticData } from "../src/lib/names";
import { normaliseMobalytics } from "../src/lib/mobalytics";
import { emptyProgress } from "../src/lib/store";
import raw from "./fixtures/necromancer-mages-necro-guide.json";

/** The bundled example build (Skeletal Warrior Minions, "End Game Warriors" variant) with nothing owned yet. */
export async function exampleBuild() {
  await loadStaticData();
  const build = normaliseMobalytics(raw as any);
  const variant = build.variants.find((v) => v.id === "1")!;
  return { build, variant, prog: () => emptyProgress };
}

/** An OCR line as the Rust side returns it. */
export const line = (text: string, x = 0, y = 0, w = 300, h = 24) => ({ text, x, y, w, h });
