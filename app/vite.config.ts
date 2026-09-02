import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://<user>.github.io/SpiralMap/ (a project page, not a user/org
  // page) — without this, built asset URLs resolve to the site root and 404.
  base: "/SpiralMap/",
  server: {
    // dataset.json and schema/spiral.ts live one level above app/ — allow Vite's
    // dev server to read outside its own root for those static imports.
    fs: { allow: [".."] },
  },
});
