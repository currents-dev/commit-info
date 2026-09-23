'use strict'

const debug = require('debug')('commit-info')
const execa = require('execa')

// On pull request builds these providers check out a commit that merges the
// pull request into its target branch. The variables hold the pull request's
// own last commit. GitHub Actions has no such variable; its sha comes from the
// event file (ghaEventData.headSha).
const HEAD_SHA_ENV_VARS = [
  'CI_MERGE_REQUEST_SOURCE_BRANCH_SHA', // GitLab merged results pipelines
  'SYSTEM_PULLREQUEST_SOURCECOMMITID', // Azure Pipelines
  'TRAVIS_PULL_REQUEST_SHA',
  'SEMAPHORE_GIT_PR_SHA',
  'BUILDKITE_PULL_REQUEST_HEAD_COMMIT',
  'BITBUCKET_COMMIT'
]

const FETCH_TIMEOUT_MS = 3000
const FETCH_RETRY_DELAY_MS = 500

/**
 * Returns the pull request's last commit when the checked-out commit is a
 * merge of the pull request into its target branch, or null.
 *
 * With `actions/checkout` defaults the clone has depth 1 and does not contain
 * that commit, so it is fetched from origin. A failed or timed-out fetch
 * returns null.
 *
 * @returns {Promise<{sha, message, email, author, timestamp} | null>}
 */
async function getPullRequestHeadCommit (folder, checkoutSha, ghaEventData) {
  try {
    const headSha = getHeadSha(ghaEventData)
    if (!checkoutSha || !headSha || headSha === checkoutSha) {
      return null
    }

    // Skips pull_request_target, where the checkout is the target branch, a
    // commit the build added on top of the pull request, and any build where
    // the variable does not describe the checked-out commit.
    const parents = await getParents(folder, checkoutSha)
    if (parents.length < 2 || !parents.includes(headSha)) {
      debug('%s is not a merge with parent %s, skipping', checkoutSha, headSha)
      return null
    }

    if (
      !await hasCommit(folder, headSha) &&
      !await fetchCommit(folder, headSha)
    ) {
      return null
    }

    return await readCommit(folder, headSha)
  } catch (e) {
    debug('failed to read the pull request head commit: %o', e)
    return null
  }
}

function getHeadSha (ghaEventData) {
  if (ghaEventData && ghaEventData.headSha) {
    return ghaEventData.headSha
  }
  const name = HEAD_SHA_ENV_VARS.find(key => process.env[key])
  return name ? process.env[name] : null
}

async function git (folder, args, timeout) {
  const { stdout } = await execa('git', args, {
    cwd: folder,
    timeout,
    env: { GIT_TERMINAL_PROMPT: '0' }
  })
  return stdout
}

// Reads the parent lines stored in the commit object. `git log --format=%P`
// and `HEAD^2` return nothing in a depth-1 clone.
async function getParents (folder, sha) {
  const commit = await git(folder, ['cat-file', 'commit', sha])
  const header = commit.split('\n\n')[0]
  return header
    .split('\n')
    .filter(line => line.startsWith('parent '))
    .map(line => line.slice('parent '.length))
}

async function hasCommit (folder, sha) {
  try {
    await git(folder, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch (e) {
    return false
  }
}

async function fetchCommit (folder, sha) {
  if (process.env.CURRENTS_DISABLE_HEAD_COMMIT_FETCH === 'true') {
    debug('fetching %s is disabled', sha)
    return false
  }

  // --depth on a complete clone would make it shallow for the rest of the job
  const isShallow = await git(folder, ['rev-parse', '--is-shallow-repository'])
  if (isShallow !== 'true') {
    return false
  }

  const args = [
    '-c',
    'credential.interactive=false',
    'fetch',
    '--depth=1',
    '--no-tags',
    '--no-recurse-submodules',
    'origin',
    sha
  ]

  // Processes sharing the checkout, such as Playwright workers, can fetch at
  // the same time; the one that loses the race for .git/shallow.lock fails.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await git(folder, args, FETCH_TIMEOUT_MS)
      return true
    } catch (e) {
      debug('fetching %s failed (attempt %d): %o', sha, attempt, e)
      if (await hasCommit(folder, sha)) {
        return true
      }
      if (e.timedOut || attempt === 2) {
        return false
      }
      await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS))
    }
  }
  return false
}

async function readCommit (folder, sha) {
  const output = await git(folder, [
    'show',
    '-s',
    '--format=%an%x00%ae%x00%ct%x00%B',
    sha
  ])
  const [author, email, timestamp, message] = output.split('\0')
  return { sha, author, email, timestamp, message }
}

module.exports = { getPullRequestHeadCommit }
