import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/Euthyna/" : "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
