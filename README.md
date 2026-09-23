# @currents/commit-info

Collects Git commit info from git CLI


## Install

Requires [Node](https://nodejs.org/en/) version 8 or above.

```sh
npm install --save @currents-dev/commit-info
```

## Use

```js
const {commitInfo} = require('@currents-dev/commit-info')
// default folder is current working directory
commitInfo(folder)
  .then(info => {
    // info object will have properties
    // branch
    // message
    // email
    // author
    // sha
    // timestamp (in seconds since epoch)
    // remote
  })
```

Notes:

- Code assumes there is `.git` folder and uses Git commands to get each property, like `git show -s --pretty=%B`, see [src/git-api.js](src/git-api.js). Note: there is fallback to environment variables.
- Resolves with [Bluebird](https://github.com/petkaantonov/bluebird) promise.
- Only uses Git commands, see [src/git-api.js](src/git-api.js)
- If a command fails, returns `null` for each property
- If you need to debug, run with `DEBUG=commit-info` environment variable.

## Pull request builds

On pull request builds many CI providers check out a commit that merges the pull request into its target branch. GitHub Actions, for example, checks out `refs/pull/<number>/merge`, whose message is `Merge <sha> into <sha>`.

When the checked-out commit is such a merge, `commitInfo` reports the pull request's last commit instead: its `sha`, `message`, `email`, `author` and `timestamp`. It finds that commit in:

- GitHub Actions: `pull_request.head.sha` in the event file (`GITHUB_EVENT_PATH`)
- GitLab merged results pipelines: `CI_MERGE_REQUEST_SOURCE_BRANCH_SHA`
- Azure Pipelines: `SYSTEM_PULLREQUEST_SOURCECOMMITID`
- Travis CI: `TRAVIS_PULL_REQUEST_SHA`
- Semaphore: `SEMAPHORE_GIT_PR_SHA`
- Buildkite: `BUILDKITE_PULL_REQUEST_HEAD_COMMIT`
- Bitbucket Pipelines: `BITBUCKET_COMMIT`

The commit is used only when the checked-out commit is a merge and the commit is one of its parents. If a shallow clone does not contain it (for example `actions/checkout` with the default `fetch-depth: 1`), it is fetched with `git fetch --depth=1 origin <sha>`, with a 3 second timeout. If the fetch fails, the checked-out commit is reported. Set `CURRENTS_DISABLE_HEAD_COMMIT_FETCH=true` to skip the fetch.

The `COMMIT_INFO_*` variables below still take priority. When `COMMIT_INFO_SHA` is set, the pull request's commit is not looked up.

## Fallback environment variables

If getting the commit information using `git` fails for some reason, you can provide the commit information by setting the environment variables. This module will look at the following environment variables as a fallback

```
branch: COMMIT_INFO_BRANCH
message: COMMIT_INFO_MESSAGE
email: COMMIT_INFO_EMAIL
author: COMMIT_INFO_AUTHOR
sha: COMMIT_INFO_SHA
timestamp: COMMIT_INFO_TIMESTAMP
remote: COMMIT_INFO_REMOTE
```

### For Docker containers

When running your application inside a Docker container, you should set these environment variables using `-e` syntax.

```shell
$ docker run \
  -e COMMIT_INFO_BRANCH=develop \
  -e COMMIT_INFO_SHA=e5d9eb66474bc0b681da9240aa5a457fe17bc8f3 \
  <container name>
```

See [docker-example](docker-example) for a full example.

## Individual methods

In addition to `commitInfo` this module also exposes individual promise-returning
methods `getBranch`, `getMessage`, `getEmail`, `getAuthor`, `getSha`, `getTimestamp`, `getRemoteOrigin`. These methods do NOT use fallback environment variables.

For example

```js
const {getAuthor} = require('@currents/commit-info')
getAuthor('path/to/repo')
  .then(name => ...)
```

### getBranch

Resolves with the current git branch name or `null`.

```js
const {getBranch} = require('@currents/commit-info')
getBranch()
  .then(branch => ...)
```

- If this is detached commit (reporting `HEAD`), returns `null`

### Small print

License: MIT - do anything with the code, but don't blame me if it does not work.

Support: if you find any problems with this module, email / tweet /
[open issue](https://github.com/currents-dev/commit-info/issues) on Github

## MIT License

Copyright (c) 2017 Cypress.io

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.


