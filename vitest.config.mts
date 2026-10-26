import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Other Claude Code sessions' worktrees are git-ignored copies of the repo: their tests would run twice.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
