// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["allure-vitest/setup"],
    reporters: [
      "default",
      ["allure-vitest/reporter", { resultsDir: "./allure-results" }],
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ["**/*.test.ts"],
  },
});