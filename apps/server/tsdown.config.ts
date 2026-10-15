import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  entry: "./src/index.ts",
  format: "esm",
  loader: { ".sql": "text" },
  noExternal: [/@manobu\/.*/],
  outDir: "./dist",
});
