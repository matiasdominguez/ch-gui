// Type-aware rules are off because `tsc --strict` runs in `npm run build`.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist", "src-tauri", "vendor", "src/assets"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
);
