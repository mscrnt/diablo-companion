import { describe, expect, it } from "vitest";
import { APP_VERSION, compareVersions } from "../src/lib/version";
import pkg from "../package.json";

describe("version", () => {
  it("is injected from package.json", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("compares x.y.z numerically", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("v0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.1", "0.1.2")).toBe(-1);
  });

  it("sorts a pre-release before its release", () => {
    expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBe(-1);
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBe(1);
    expect(compareVersions("0.2.0-rc.1", "0.1.9")).toBe(1);
  });
});
