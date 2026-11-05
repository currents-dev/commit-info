---
name: currents-release-package
description: Release @currents/commit-info to npm — the version and CHANGELOG commit, the PR, the publish workflow and the check of the published package. Use for latest releases and for alpha and beta prereleases.
argument-hint: <version> [channel]
---

# Release @currents/commit-info to npm

Arguments: the version and the npm channel. Without a channel, a version like
`3.1.0` goes to `latest` and `3.1.0-beta.0` goes to `beta`. Ask for anything
missing.

Publishing changes the npm package and its dist-tag. The operator runs the
publish command; give it ready to run with `!`. You prepare the release
commit, open the PR, merge it when approved, and check the result.

## How releases work here

- `.github/workflows/publish.yaml` publishes. It is started by hand with a
  channel (`alpha`, `beta` or `latest`). It publishes the version in
  `package.json` of the ref it runs on, with npm provenance.
- The workflow checks that the version fits the channel: `3.1.0` for
  `latest`, `3.1.0-beta.0` for `beta`, `3.1.0-alpha.0` for `alpha`. Then it
  runs the unit tests before it publishes.
- The repo has no tags or GitHub releases for versions. `CHANGELOG.md` is
  written by hand, with one `## <version>` section per latest release.
- PRs are merged with a merge commit and need one approval.

## 1. Before you start

- `npm view @currents/commit-info dist-tags` shows what each channel has now.
  The new version must be higher than the channel's current version.
- Check that no publish run is in progress:
  `gh run list --workflow publish.yaml`.

## 2. Make the release commit

- latest: on the PR that holds the changes, or on a branch
  `release/<version>` from `master`.
- alpha or beta: on a branch `release/<version>` from the commit to test,
  usually `master` or the head of an open PR.

Then:

- `npm version <version> --no-git-tag-version` sets the version in
  `package.json` and `package-lock.json`.
- For latest, add a `## <version>` section at the top of `CHANGELOG.md`. Lead
  with what users of the package notice: breaking changes and what callers
  have to change first, then the other changes. The earlier sections show the
  style. Prereleases get no section.
- Commit with `chore: release <version>`.

## 3. Check the package

- `npm test` (lint, then the unit tests) on Node.js 22 and 24, the versions
  `.github/workflows/main.yml` tests.
- `npm pack`, install the tarball in an empty folder, and call
  `commitInfo()` in a git repository. `npm ls --omit=dev` there shows the
  runtime dependencies; compare them with the previous version.
- For a breaking change, check the packages that use commit-info with the
  packed version: `@currents/cmd` in currents-dev/currents-reporter and the
  Currents Playwright reporter.

## 4. PR and merge

For latest:

- Open the PR to `master`, or add the release commit to the PR that holds
  the changes. The body lists the changes, the checks from step 3 with their
  results, and starts with an `Owner: @<login>` line naming the operator.
- Load the `writing-voice` skill if it is available, and show the body to the
  operator before you open the PR.
- When CI passes and the PR is approved, merge it with a merge commit:
  `gh pr merge <n> --merge`.

For alpha or beta, push the `release/<version>` branch. It needs no PR: the
publish runs from the branch.

## 5. Publish

Give the operator the publish command. The ref is `master` for latest, and
the `release/<version>` branch for alpha or beta:

```bash
gh workflow run publish.yaml --repo currents-dev/commit-info --ref <ref> -f channel=<channel>
```

## 6. Check the published package

- Watch the publish run to the end: `gh run watch <run id> --exit-status`.
- `npm view @currents/commit-info dist-tags` shows the new version on the
  channel. `npm view @currents/commit-info@<version> dist.attestations` shows
  the provenance.
- Install the version from npm in an empty folder and repeat the checks from
  step 3.

If the published version is broken, give the operator the commands to move
the channel back and mark the version:

```bash
npm dist-tag add @currents/commit-info@<previous version> <channel>
npm deprecate @currents/commit-info@<version> "<what is broken>; use <previous version>"
```

Do not unpublish: lockfiles that already have the version stop installing.

## Report

End with a table of the steps — release commit, PR, merge, publish run, npm
dist-tag, check from npm — each linked to its PR, run or npm page, with the
evidence you checked.
