import { loadStaticData } from "../src/lib/names";
import { emptyProgress } from "../src/lib/store";
import { EXAMPLE_BUILD } from "./fixtures/example-build";

/** Our own example build (Skeleton Warrior Army, "Endgame Warriors" variant) with nothing owned yet. */
export async function exampleBuild() {
  await loadStaticData();
  // a copy per test file, so one test changing a slot can't reach another
  const build = structuredClone(EXAMPLE_BUILD);
  const variant = build.variants.find((v) => v.id === "1")!;
  return { build, variant, prog: () => emptyProgress };
}

/** An OCR line as the Rust side returns it. */
export const line = (text: string, x = 0, y = 0, w = 300, h = 24) => ({ text, x, y, w, h });
