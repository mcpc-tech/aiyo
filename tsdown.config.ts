import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["packages/core/src/index.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  sourcemap: true,
  clean: true,
  unbundle: true,
  minify: false,
});
