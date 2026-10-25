// One paste box, four sites. A build is fetched only when the player pastes its link, and
// only that one build: nothing is searched, listed, refreshed in the background or kept
// from a site's own catalog.
import { importD4Builds } from "./d4builds";
import { importIcyVeins } from "./icyveins";
import { importMaxroll } from "./maxroll";
import { importMobalytics, type ImportOptions } from "./mobalytics";
import type { Build, BuildSource } from "./types";

export const SITE_LABEL: Record<BuildSource, string> = {
  mobalytics: "Mobalytics",
  maxroll: "Maxroll",
  "icy-veins": "Icy Veins",
  d4builds: "d4builds",
};

export const SITE_HOME: Record<BuildSource, string> = {
  mobalytics: "https://mobalytics.gg/diablo-4/builds",
  maxroll: "https://maxroll.gg/d4/build-guides",
  "icy-veins": "https://www.icy-veins.com/d4/",
  d4builds: "https://d4builds.gg/",
};

/** Which site a pasted link is from. A bare slug is a Mobalytics build, as it always was. */
export function siteOf(input: string): BuildSource | null {
  const s = input.trim();
  if (!s) return null;
  if (!s.includes("/")) return "mobalytics";
  let host: string;
  try {
    host = new URL(s).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (host === "mobalytics.gg") return "mobalytics";
  if (host === "maxroll.gg" || host.endsWith(".maxroll.gg")) return "maxroll";
  if (host === "icy-veins.com" || host.endsWith(".icy-veins.com")) return "icy-veins";
  if (host === "d4builds.gg" || host.endsWith(".d4builds.gg")) return "d4builds";
  return null;
}

export interface Imported {
  build: Build;
  via: string;
  defaultVariant?: string;
}

/** Fetch and normalise the one build behind a pasted link. */
export async function importBuild(input: string, opts: ImportOptions = {}): Promise<Imported> {
  switch (siteOf(input)) {
    case "mobalytics":
      return importMobalytics(input, opts);
    case "maxroll":
      return importMaxroll(input);
    case "icy-veins":
      return importIcyVeins(input);
    case "d4builds":
      return importD4Builds(input);
    default:
      throw new Error("I don't know that site. Paste a build link from Mobalytics, Maxroll, Icy Veins or d4builds.");
  }
}
