import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node18",
  dts: false,
  sourcemap: true,
  clean: true,
  unbundle: true,
  minify: false,
});
