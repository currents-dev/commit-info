'use strict'

/* eslint-env mocha */
const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const mockedEnv = require('mocked-env')
const { commitInfo } = require('.')
const { getPullRequestHeadCommit } = require('./pull-request-head')

const commitEnv = (name, email, date) => ({
  GIT_AUTHOR_NAME: name,
  GIT_AUTHOR_EMAIL: email,
  GIT_AUTHOR_DATE: date,
  GIT_COMMITTER_NAME: name,
  GIT_COMMITTER_EMAIL: email,
  GIT_COMMITTER_DATE: date
})

const runGit = (env, cwd, args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env)
  }).trim()

const git = (cwd, ...args) =>
  runGit(
    commitEnv('Target Author', 'target@example.com', '1700000000 +0000'),
    cwd,
    args
  )

/**
 * An origin repo with a pull request (branch "feature") and two merges of it
 * into "main":
 * - refs/pull/1/merge, made by GitHub: parent 1 is main, parent 2 the pull request
 * - refs/heads/local-merge, made by Bitbucket Pipelines or Jenkins: parent 1
 *   is the pull request, parent 2 main
 */
function createOrigin (root) {
  const origin = path.join(root, 'origin')
  git(root, 'init', '-q', origin)
  git(origin, 'checkout', '-q', '-b', 'main')
  // git before 2.29 (protocol v0) only serves advertised refs by default
  git(origin, 'config', 'uploadpack.allowReachableSHA1InWant', 'true')
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'target 1')
  git(origin, 'checkout', '-q', '-b', 'feature')
  runGit(commitEnv('PR Author', 'pr@example.com', '1600000000 +0000'), origin, [
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'feat: add retries\n\nLonger description.'
  ])
  const headSha = git(origin, 'rev-parse', 'HEAD')
  git(origin, 'checkout', '-q', 'main')
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'target 2')
  const baseSha = git(origin, 'rev-parse', 'HEAD')
  const tree = git(origin, 'rev-parse', 'HEAD^{tree}')

  const mergeSha = git(
    origin,
    ...['commit-tree', tree, '-p', baseSha, '-p', headSha],
    ...['-m', `Merge ${headSha} into ${baseSha}`]
  )
  git(origin, 'update-ref', 'refs/pull/1/merge', mergeSha)

  const localMergeSha = git(
    origin,
    ...['commit-tree', tree, '-p', headSha, '-p', baseSha],
    ...['-m', 'Merge branch main']
  )
  git(origin, 'update-ref', 'refs/heads/local-merge', localMergeSha)

  return { origin, headSha, baseSha, mergeSha, localMergeSha }
}

const prCommit = sha => ({
  sha,
  author: 'PR Author',
  email: 'pr@example.com',
  timestamp: '1600000000',
  // same format as the message commit-info reads for the checked-out commit
  message: 'feat: add retries\n\nLonger description.\n'
})

describe('getPullRequestHeadCommit', function () {
  this.timeout(20000)

  let root, repo, workRoot, restoreEnvironment

  /** Checks out `ref` of the origin in a new repo */
  function checkout (ref, depth) {
    const work = path.join(workRoot, 'work')
    git(workRoot, 'init', '-q', work)
    git(work, 'remote', 'add', 'origin', `file://${repo.origin}`)
    git(
      work,
      ...['fetch', '-q', ...(depth ? [`--depth=${depth}`] : [])],
      ...['origin', `+${ref}:refs/remotes/origin/checkout`]
    )
    git(work, 'checkout', '-q', '--detach', 'refs/remotes/origin/checkout')
    return work
  }

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-head-commit-'))
    repo = createOrigin(root)
  })

  after(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    workRoot = fs.mkdtempSync(path.join(root, 'test-'))
    // provider variables from the machine running the tests would change the result
    restoreEnvironment = mockedEnv(
      { PATH: process.env.PATH, HOME: process.env.HOME },
      { clear: true }
    )
  })

  afterEach(() => {
    restoreEnvironment()
  })

  it('fetches the pull request commit in a depth-1 checkout', async () => {
    const work = checkout('refs/pull/1/merge', 1)

    assert.deepStrictEqual(
      await getPullRequestHeadCommit(work, repo.mergeSha, {
        headSha: repo.headSha
      }),
      prCommit(repo.headSha)
    )
    assert.strictEqual(git(work, 'rev-parse', 'HEAD'), repo.mergeSha)
  })

  it('reads the pull request commit from a full clone without fetching', async () => {
    const work = checkout('refs/pull/1/merge')
    git(work, 'remote', 'set-url', 'origin', path.join(root, 'missing'))

    assert.deepStrictEqual(
      await getPullRequestHeadCommit(work, repo.mergeSha, {
        headSha: repo.headSha
      }),
      prCommit(repo.headSha)
    )
  })

  it('takes the sha from a provider variable', async () => {
    const work = checkout('refs/pull/1/merge', 1)
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA = repo.headSha

    assert.deepStrictEqual(
      await getPullRequestHeadCommit(work, repo.mergeSha),
      prCommit(repo.headSha)
    )
  })

  it('accepts the pull request commit as the first parent', async () => {
    const work = checkout('refs/heads/local-merge', 1)
    process.env.BITBUCKET_COMMIT = repo.headSha

    assert.deepStrictEqual(
      await getPullRequestHeadCommit(work, repo.localMergeSha),
      prCommit(repo.headSha)
    )
  })

  it('returns null when the checkout is not a merge of the pull request', async () => {
    // pull_request_target checks out the target branch
    const work = checkout('refs/heads/main', 1)

    assert.strictEqual(
      await getPullRequestHeadCommit(work, repo.baseSha, {
        headSha: repo.headSha
      }),
      null
    )
  })

  it('returns null when the checkout is the pull request commit', async () => {
    const work = checkout('refs/heads/feature', 1)
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA = repo.headSha

    assert.strictEqual(await getPullRequestHeadCommit(work, repo.headSha), null)
  })

  it('does not fetch when CURRENTS_DISABLE_HEAD_COMMIT_FETCH is set', async () => {
    const work = checkout('refs/pull/1/merge', 1)
    process.env.CURRENTS_DISABLE_HEAD_COMMIT_FETCH = 'true'

    assert.strictEqual(
      await getPullRequestHeadCommit(work, repo.mergeSha, {
        headSha: repo.headSha
      }),
      null
    )
    assert.throws(() => git(work, 'cat-file', '-e', repo.headSha))
  })

  it('returns null when the fetch fails', async () => {
    const work = checkout('refs/pull/1/merge', 1)
    git(work, 'remote', 'set-url', 'origin', path.join(root, 'missing'))

    assert.strictEqual(
      await getPullRequestHeadCommit(work, repo.mergeSha, {
        headSha: repo.headSha
      }),
      null
    )
  })

  it('returns null outside a git repository', async () => {
    assert.strictEqual(
      await getPullRequestHeadCommit(workRoot, repo.mergeSha, {
        headSha: repo.headSha
      }),
      null
    )
  })

  describe('commitInfo', () => {
    let work

    beforeEach(() => {
      work = checkout('refs/pull/1/merge', 1)
      const eventPath = path.join(workRoot, 'event.json')
      fs.writeFileSync(
        eventPath,
        JSON.stringify({
          pull_request: {
            title: 'Add retries',
            head: { ref: 'feature', sha: repo.headSha },
            base: { ref: 'main', sha: repo.baseSha }
          },
          sender: {}
        })
      )
      process.env.GITHUB_ACTIONS = 'true'
      process.env.GITHUB_EVENT_PATH = eventPath
    })

    it('reports the pull request commit on a GitHub Actions merge checkout', async () => {
      const info = await commitInfo(work)

      assert.deepStrictEqual(
        {
          sha: info.sha,
          message: info.message,
          author: info.author,
          email: info.email,
          timestamp: info.timestamp
        },
        prCommit(repo.headSha)
      )
      assert.strictEqual(info.ghaEventData.headSha, repo.headSha)
    })

    it('gives COMMIT_INFO_* variables priority over the pull request commit', async () => {
      process.env.COMMIT_INFO_MESSAGE = 'message from env'

      const info = await commitInfo(work)

      assert.strictEqual(info.sha, repo.headSha)
      assert.strictEqual(info.message, 'message from env')
      assert.strictEqual(info.author, 'PR Author')
    })

    it('reports the checked-out commit when COMMIT_INFO_SHA is set', async () => {
      process.env.COMMIT_INFO_SHA = repo.mergeSha

      const info = await commitInfo(work)

      assert.strictEqual(info.sha, repo.mergeSha)
      assert.strictEqual(
        info.message,
        `Merge ${repo.headSha} into ${repo.baseSha}\n`
      )
    })
  })
})
