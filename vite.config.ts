/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Tests that need real game names read the data extracted on this PC (tests/setup.ts). Nothing from the game is in
// the repo, so without it (CI) these files are left out; the rest use our own hand-written fixtures.
// @ts-expect-error process is a nodejs global
const gameData = process.env.GAMEDATA_DIR ?? "data/gamedata";
const NEEDS_GAME_DATA = [
  "activities", "build", "charsheet", "every-build", "glyph-levels", "hordes-offers", "identify", "importers", "judge",
  "mappins", "no-ai-1080p", "ocrfix", "plain-items", "untitled", "worn-item",
].map((f) => `tests/${f}.test.ts`);
const hasGameData = existsSync(`${gameData}/affixes.json`) && existsSync(`${gameData}/generated/ocr-vocab.json`);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // the map-tracker tests correlate whole frames: a few seconds each, and longer when the
  // rest of the suite is running beside them, so they get more than vitest's 5 s default
  test: { include: ["tests/**/*.test.ts"], exclude: hasGameData ? [] : NEEDS_GAME_DATA, environment: "node", testTimeout: 20000, setupFiles: ["tests/setup.ts"] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/data/**", "**/tools/**"],
    },
  },
}));
