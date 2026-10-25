import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  envDir: path.join(root, "preview"),
  root: path.join(root, "preview"),
  publicDir: false,
  build: { outDir: path.join(root, "ui-preview-dist"), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
