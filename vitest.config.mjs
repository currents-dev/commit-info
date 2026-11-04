import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // the specs are CommonJS and cannot import from 'vitest'
    globals: true,
    // git-api-spec.js calls process.chdir, which worker threads do not allow
    pool: 'forks',
    // the git fetches in pull-request-head.js time out after 3 s, which test
    // files running at the same time can exceed
    fileParallelism: false,
    // the timeout option of describe() in the specs does not cover hooks, which
    // create git repositories
    hookTimeout: 20000,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/*-spec.js'] }
      },
      {
        // needs the GitHub Actions event file, see .github/workflows/main.yml
        extends: true,
        test: { name: 'e2e', include: ['src/utils-e2e.js'] }
      }
    ]
  }
})
