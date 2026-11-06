import { defineConfig } from "vite";

// base "./" makes every path relative, so the built app works from any folder
// (on adamdobrer.ca it lives at /projects/sheet-letters/app/).
export default defineConfig({
  base: "./",
  build: { target: "es2022", assetsInlineLimit: 0 },
  worker: { format: "es" },
});
