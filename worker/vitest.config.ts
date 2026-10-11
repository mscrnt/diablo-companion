import { defineConfig } from "vitest/config";

// the app's vite.config.ts one folder up would otherwise be used
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
