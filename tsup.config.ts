import { defineConfig } from "tsup";
import { name } from "./package.json";

export default defineConfig({
  name,
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  bundle: true,
  splitting: false,
  dts: {
    resolve: true,
  },
});
