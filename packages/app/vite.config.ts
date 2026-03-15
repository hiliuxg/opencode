import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const basePath = process.env.OPENCODE_BASE_PATH
  ? `${process.env.OPENCODE_BASE_PATH.replace(/\/$/, "")}/`
  : "/"

export default defineConfig({
  base: basePath,
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
