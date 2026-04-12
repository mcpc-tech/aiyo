import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/run-cli.ts",
    "src/bin.ts",
    "src/config.ts",
    "src/proxy-server.ts",
    "src/opencode.ts",
    "src/claude-code.ts",
  ],
  format: ["esm"],
  platform: "node",
  target: "node18",
  dts: true,
  sourcemap: true,
  clean: true,
  unbundle: true,
  minify: false,
});
