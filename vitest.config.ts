import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 4,
    exclude: [...configDefaults.exclude, "dist/**"],
  },
})
