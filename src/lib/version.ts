// App version (injected from package.json at build time), the update check and
// in-app updates (Tauri updater, signed packages from the GitHub release).
import type { Update } from "@tauri-apps/plugin-updater";
import { httpJson, isTauri } from "./http";

export const APP_VERSION: string = __APP_VERSION__;
export const REPO_URL = "https://github.com/mscrnt/diablo-companion";
export const RELEASES_URL = `${REPO_URL}/releases`;

export interface UpdateInfo {
  version: string;
  url: string;
  publishedAt: string;
  /** true when the signed update can be installed from inside the app */
  installable: boolean;
}

let pending: Update | null = null;

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
  if (isTauri) {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      pending = await check();
      if (!pending) return null;
      return { version: pending.version, url: `${RELEASES_URL}/tag/v${pending.version}`, publishedAt: pending.date ?? "", installable: true };
    } catch {
      // releases from before the updater have no latest.json; fall back to a plain notice
    }
  }
  const r = await httpJson<{ tag_name: string; html_url: string; published_at: string; draft: boolean; prerelease: boolean }>(
    "https://api.github.com/repos/mscrnt/diablo-companion/releases/latest",
    { headers: { Accept: "application/vnd.github+json", "User-Agent": `sanctuary-toolkit/${APP_VERSION}` }, timeoutMs: 15000 },
  );
  if (r.draft || r.prerelease) return null;
  const version = r.tag_name.replace(/^v/, "");
  return compareVersions(version, APP_VERSION) > 0 ? { version, url: r.html_url, publishedAt: r.published_at, installable: false } : null;
}

/** Download, verify and install the update found by checkForUpdate, then restart. */
export async function installUpdate(onProgress: (fraction: number | null) => void) {
  if (!pending) throw new Error("No update to install. Check for updates first.");
  let total = 0;
  let got = 0;
  await pending.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      got += e.data.chunkLength;
      onProgress(total ? got / total : null);
    } else if (e.event === "Finished") onProgress(1);
  });
  // the installer usually closes the app itself; restart in case it didn't
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
