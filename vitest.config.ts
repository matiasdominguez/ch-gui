import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    // .claude/ holds worktrees, which are other checkouts with their own tests.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
