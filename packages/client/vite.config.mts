import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
  },
  // Assets are loaded via file:// once packaged, so paths must be relative.
  base: "./",
  build: {
    outDir: "dist",
  },
});
