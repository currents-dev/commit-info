# Changelog

## Unreleased

Breaking: the functions return a native `Promise` instead of a Bluebird promise. Bluebird methods such as `.tap()` and `.spread()` are no longer available on the result. Code that uses `await` or `.then()` does not change.

- The only runtime dependency is `debug`. `bluebird`, `execa`, `lazy-ass` and `check-more-types` are removed, which removes 22 packages from an install.
- git runs with `child_process.spawn`, without a shell, as before. When Node exits, git commands that still run are killed, as before.
- `debug` is 4.4.3.

Other differences from execa 1.0:

- The `node_modules/.bin` folders and the folder of the `node` binary are not added to `PATH`, so a `git` file in `node_modules/.bin` is not used.
- A signal that ends Node without an `exit` event, such as a SIGTERM sent to the Node process alone, leaves running git commands running. execa killed them. A signal sent to the process group, such as Ctrl+C in a terminal, still reaches git.
- When git prints more than 10 MB, the error is a plain `Error` with the message `stdout maxBuffer exceeded`, not a `MaxBufferError`.

## 2.0.0

Breaking: `commitInfo()` returns other values than 1.x.

- Fills the fields git could not read from the CI provider's variables: GitHub Actions, GitLab, CircleCI, Jenkins, Azure Pipelines, Bitbucket Pipelines, Buildkite, AWS CodeBuild, and the providers listed in `src/ci.js`. Priority: `COMMIT_INFO_*`, then git, then the CI provider. The variables are the ones the Currents Playwright reporter used.
- `remote` comes from `COMMIT_INFO_REMOTE`, then the CI provider's variables, then git. The CI providers that set a remote are AWS CodeBuild, Azure Pipelines, Bamboo, Buildkite, CircleCI, Drone, GitLab, Semaphore and Netlify. This is the rule the Currents Playwright reporter used.
- On Semaphore, `remote` is the clone URL in `SEMAPHORE_GIT_URL`. The Currents Playwright reporter reported `SEMAPHORE_GIT_REPO_SLUG` (`owner/repo`), which Currents could not build commit links from.
- On Bamboo, `remote` comes from `bamboo_planRepository_repositoryUrl`. The Currents Playwright reporter read `bamboo_planRepository_repositoryURL`, which Bamboo does not set.
- `remote` has no user name or password, also in the `DEBUG=commit-info` output and from `getRemoteOrigin()` and `getCiCommitInfo()`.
- On CI, when git refuses a repository owned by another user ("dubious ownership"), the read-only git commands run again with `-c safe.directory=*`. CI means that `CI` is set or a CI provider is detected, so Jenkins counts. `GOOGLE_CLOUD_PROJECT`, `GCP_PROJECT`, `GCLOUD_PROJECT` and `JENKINS_HOME` alone do not count.
- Prints one warning when git fails and fields stay empty, also when git is not in `PATH`.
- New exports: `getCiCommitInfo`, `detectCiProvider`, `removeCredentials`, and TypeScript types.

Migration:

- If your code fills empty `commitInfo()` fields from CI provider variables, remove it: `commitInfo()` does that now.
- If your code replaces the git remote with the CI provider's remote, remove it: `commitInfo()` returns `COMMIT_INFO_REMOTE`, else the CI provider's remote, else the git remote, without credentials.
