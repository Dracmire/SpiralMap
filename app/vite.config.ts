import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // dataset.json and schema/spiral.ts live one level above app/ — allow Vite's
    // dev server to read outside its own root for those static imports.
    fs: { allow: [".."] },
  },
});
