import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPlugin from "vite-plugin-monaco-editor";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const monacoEditor =
  (monacoEditorPlugin as unknown as { default: typeof monacoEditorPlugin })
    .default ?? monacoEditorPlugin;

export default defineConfig(async () => ({
  plugins: [
    react(),
    monacoEditor({
      languageWorkers: ["editorWorkerService"],
    }),
  ],

  // Clearing the screen would hide Rust errors printed by `tauri dev`.
  clearScreen: false,
  // Tauri's devUrl needs this port, so Vite must fail when it is taken.
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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
