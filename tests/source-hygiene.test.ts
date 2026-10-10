// Guards against a recurring editing accident: a regex's `\b` written as a literal
// backspace character, which silently never matches.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (["node_modules", "generated", ".out"].includes(e.name) ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );

describe("source hygiene", () => {
  it("has no control characters in source files", () => {
    const bad: string[] = [];
    for (const f of ["src", "scripts", "tests"].flatMap((d) => walk(join(root, d))).filter((f) => /\.(ts|tsx|mjs)$/.test(f))) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(l)) bad.push(`${f}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
