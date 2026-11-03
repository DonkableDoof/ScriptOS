import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

// package.json is the one place the version lives. Tauri reads it from there too.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1440, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: ["es2021", "chrome105", "safari13"] },
});
