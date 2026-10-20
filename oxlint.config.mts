import config from "@determinate-systems/oxlint-config/typed";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist"],

  rules: {
    // There are a ton of these that are going to take some time to fix
    "typescript/no-unsafe-member-access": "warn",
    "typescript/no-unsafe-assignment": "warn",
  },
});
