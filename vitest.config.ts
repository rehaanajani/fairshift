import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { FAIRSHIFT_AI: "off" },
    coverage: { include: ["server/**", "web/i18n.ts"], reporter: ["text-summary", "html"] },
  },
});
