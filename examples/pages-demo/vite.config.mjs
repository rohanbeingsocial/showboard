import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves the page from /showboard/, so asset paths stay relative.
export default defineConfig({ base: "./", plugins: [react()] });
