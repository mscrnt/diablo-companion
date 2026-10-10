// App version (injected from package.json at build time) and a GitHub release check.
import { httpJson } from "./http";

export const APP_VERSION: string = __APP_VERSION__;
export const REPO_URL = "https://github.com/mscrnt/diablo-companion";
export const RELEASES_URL = `${REPO_URL}/releases`;

export interface UpdateInfo {
  version: string;
  url: string;
  publishedAt: string;
}

/** Numeric x.y.z compare; a pre-release (x.y.z-rc.1) sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The newest published release if it's newer than this build, else null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const r = await httpJson<{ tag_name: string; html_url: string; published_at: string; draft: boolean; prerelease: boolean }>(
    "https://api.github.com/repos/mscrnt/diablo-companion/releases/latest",
    { headers: { Accept: "application/vnd.github+json", "User-Agent": `sanctuary-toolkit/${APP_VERSION}` }, timeoutMs: 15000 },
  );
  if (r.draft || r.prerelease) return null;
  const version = r.tag_name.replace(/^v/, "");
  return compareVersions(version, APP_VERSION) > 0 ? { version, url: r.html_url, publishedAt: r.published_at } : null;
}
