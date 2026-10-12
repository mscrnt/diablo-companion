import { describe, expect, it } from "vitest";
import { checkSize, deleteOn, expiredReleaseTags, isZip, issueFor, objectKey, parseMeta, releaseTag, ulid } from "../src/validate";

describe("report metadata", () => {
  it("accepts what the app sends", () => {
    expect(parseMeta('{"version":"0.2.0","os":"windows-11","screenshots":true}')).toEqual({ ok: true, value: { version: "0.2.0", os: "windows-11", screenshots: true } });
    expect(parseMeta('{"version":"10.20.30","os":"windows"}')).toMatchObject({ ok: true, value: { screenshots: false } });
    // pre-release builds report their real version
    expect(parseMeta('{"version":"0.2.0-rc.1","os":"windows-11"}')).toMatchObject({ ok: true, value: { version: "0.2.0-rc.1" } });
    expect(parseMeta('{"version":"0.3.0-beta.12","os":"windows-10"}').ok).toBe(true);
  });
  it("rejects anything else", () => {
    for (const h of [null, "", "nope", "[]", '{"version":"0.2","os":"windows-11"}', '{"version":"0.2.0-hello world","os":"windows-11"}', '{"version":"0.2.0-rc","os":"windows-11"}', '{"version":"0.2.0-rc.1<script>","os":"windows-11"}','{"version":"0.2.0","os":"linux"}', '{"version":"0.2.0","os":"windows-11","screenshots":"yes"}', "x".repeat(600)])
      expect(parseMeta(h).ok, String(h)).toBe(false);
  });
});

describe("zip and size checks", () => {
  const zip = new Uint8Array(30);
  zip.set([0x50, 0x4b, 0x03, 0x04]);
  it("knows a zip by its magic bytes", () => {
    expect(isZip(zip)).toBe(true);
    expect(isZip(new Uint8Array(30))).toBe(false);
    expect(isZip(zip.slice(0, 10))).toBe(false);
  });
  it("refuses an oversized declared length before reading", () => {
    expect(checkSize("1000", 2000)).toEqual({ ok: true, value: 1000 });
    expect(checkSize("3000", 2000)).toMatchObject({ ok: false, status: 413 });
    expect(checkSize("-1", 2000)).toMatchObject({ ok: false, status: 400 });
    expect(checkSize(null, 2000)).toEqual({ ok: true, value: null });
  });
});

describe("ids and keys", () => {
  it("makes a 26-character ULID that sorts by time", () => {
    const a = ulid(1_760_000_000_000);
    const b = ulid(1_760_000_000_001);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });
  it("stores under the prefix and the UTC date", () => {
    expect(objectKey("debug/", "01ABC", new Date("2026-10-11T23:59:00Z"))).toBe("debug/2026-10-11/01ABC.zip");
    expect(objectKey("debug", "01ABC", new Date("2026-10-11T00:00:00Z"))).toBe("debug/2026-10-11/01ABC.zip");
  });
});

describe("GitHub issue body", () => {
  const meta = { version: "0.2.0", os: "windows-11" as const, screenshots: true };
  it("public repo: metadata only", () => {
    const { title, body } = issueFor("01ABC", meta, 2048, "debug/2026-10-11/01ABC.zip", false);
    expect(title).toBe("Debug report 01ABC");
    expect(body).toMatch(/0\.2\.0/);
    expect(body).toMatch(/windows-11/);
    expect(body).toMatch(/2 KB/);
    expect(body).not.toMatch(/debug\/2026|Screenshots|http/);
  });
  it("private repo: also the storage key and screenshots flag", () => {
    const { body } = issueFor("01ABC", meta, 2048, "debug/2026-10-11/01ABC.zip", true);
    expect(body).toMatch(/debug\/2026-10-11\/01ABC\.zip/);
    expect(body).toMatch(/Screenshots \| yes/);
  });
});

describe("report zips in the private repo, kept 30 days", () => {
  it("one release per day, deleted 30 days later", () => {
    expect(releaseTag("2026-10-12")).toBe("reports-2026-10-12");
    expect(deleteOn("2026-10-12", 30)).toBe("2026-11-11");
    expect(deleteOn("2026-12-20", 30)).toBe("2027-01-19");
  });

  it("only report releases that reached their delete day go", () => {
    const tags = ["reports-2026-10-12", "reports-2026-10-13", "v0.2.0", "reports-oops"];
    expect(expiredReleaseTags(tags, new Date("2026-11-10T09:23:00Z"), 30)).toEqual([]);
    expect(expiredReleaseTags(tags, new Date("2026-11-11T09:23:00Z"), 30)).toEqual(["reports-2026-10-12"]);
    expect(expiredReleaseTags(tags, new Date("2026-12-01T09:23:00Z"), 30)).toEqual(["reports-2026-10-12", "reports-2026-10-13"]);
  });

  it("the issue links the zip only in a private repo", () => {
    const meta = { version: "0.2.0", os: "windows-11" as const, screenshots: true };
    const dl = { url: "https://github.com/o/r/releases/download/reports-2026-10-12/X.zip", until: "2026-11-11" };
    expect(issueFor("X", meta, 2048, "debug/2026-10-12/X.zip", true, new Date(), dl).body).toMatch(/\[X\.zip\]\(https:.*\) \(deleted on 2026-11-11\)/);
    expect(issueFor("X", meta, 2048, "debug/2026-10-12/X.zip", false, new Date(), dl).body).not.toMatch(/X\.zip|releases/);
  });
});
