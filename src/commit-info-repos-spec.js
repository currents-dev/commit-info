'use strict'

/* eslint-env mocha */
const assert = require('assert')
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TOKEN = 'glcbt-64_SECRET_TOKEN'
const GITLAB_REMOTE = `https://gitlab-ci-token:${TOKEN}@gitlab.com/org/repo.git`

// An empty HOME for commitInfo, because a global git config can mark every
// repository as safe, as the GitHub Actions runner does
let home

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      GIT_AUTHOR_NAME: 'Jane',
      GIT_AUTHOR_EMAIL: 'jane@example.com',
      GIT_COMMITTER_NAME: 'Jane',
      GIT_COMMITTER_EMAIL: 'jane@example.com'
    })
  }).trim()

/**
 * Runs commitInfo in a new process, so the CI variables of the machine that
 * runs the tests do not apply.
 * Resolves with the result and everything the process printed.
 */
function runCommitInfo (cwd, env) {
  const script = `require(${JSON.stringify(__dirname)}).commitInfo()
    .then(info => console.log(JSON.stringify(info)))`
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({ PATH: process.env.PATH, HOME: home }, env)
  })
  assert.strictEqual(child.status, 0, child.stderr)
  const lines = child.stdout.trim().split('\n')
  return {
    info: JSON.parse(lines[lines.length - 1]),
    output: child.stdout + child.stderr,
    stderr: child.stderr
  }
}

describe('commitInfo in real repositories', function () {
  this.timeout(20000)

  let root, repo, sha

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-info-repos-'))
    home = path.join(root, 'home')
    fs.mkdirSync(home)
    repo = path.join(root, 'repo')
    git(root, 'init', '-q', '-b', 'main', repo)
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: first')
    git(repo, 'remote', 'add', 'origin', GITLAB_REMOTE)
    fs.mkdirSync(path.join(repo, 'sub'))
    sha = git(repo, 'rev-parse', 'HEAD')
  })

  after(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  afterEach(() => {
    git(repo, 'checkout', '-q', 'main')
  })

  it('reads the branch from git', () => {
    const { info, stderr } = runCommitInfo(repo, {})
    assert.strictEqual(info.branch, 'main')
    assert.strictEqual(info.sha, sha)
    assert.strictEqual(info.message.trim(), 'feat: first')
    assert.strictEqual(info.author, 'Jane')
    assert.strictEqual(info.email, 'jane@example.com')
    assert.strictEqual(stderr, '')
  })

  it('reports no branch for a detached checkout outside CI', () => {
    git(repo, 'checkout', '-q', '--detach')
    const { info, stderr } = runCommitInfo(repo, {})
    assert.strictEqual(info.branch, null)
    assert.strictEqual(info.sha, sha)
    assert.strictEqual(stderr, '')
  })

  it('prefers COMMIT_INFO_BRANCH to git and keeps it as it is', () => {
    const { info } = runCommitInfo(repo, {
      COMMIT_INFO_BRANCH: 'refs/heads/from-env'
    })
    assert.strictEqual(info.branch, 'refs/heads/from-env')
  })

  describe('credentials', () => {
    const gitlabEnv = {
      GITLAB_CI: 'true',
      CI: 'true',
      CI_REPOSITORY_URL: GITLAB_REMOTE,
      CI_COMMIT_REF_NAME: 'main',
      DEBUG: 'commit-info'
    }

    it('are not in the result or the debug output', () => {
      const { info, output } = runCommitInfo(repo, gitlabEnv)
      assert.strictEqual(info.remote, 'https://gitlab.com/org/repo.git')
      assert(output.includes('git stdout:'), 'expected the debug output')
      assert(!output.includes(TOKEN), output)
    })

    it('are removed from COMMIT_INFO_REMOTE', () => {
      const { info, output } = runCommitInfo(
        repo,
        Object.assign({ COMMIT_INFO_REMOTE: GITLAB_REMOTE }, gitlabEnv)
      )
      assert.strictEqual(info.remote, 'https://gitlab.com/org/repo.git')
      assert(!output.includes(TOKEN), output)
    })
  })

  it('does not warn when the repository has no remote', () => {
    const noRemote = path.join(root, 'no-remote')
    git(root, 'init', '-q', noRemote)
    git(noRemote, 'commit', '-q', '--allow-empty', '-m', 'feat: first')
    const { info, stderr } = runCommitInfo(noRemote, { CI: 'true' })
    assert.strictEqual(info.remote, null)
    assert.strictEqual(stderr, '')
  })

  it('has no values when git is not in PATH', () => {
    const { info } = runCommitInfo(repo, { PATH: root })
    assert.strictEqual(info.sha, null)
    assert.strictEqual(info.branch, null)
    assert.strictEqual(info.remote, null)
  })

  describe('repository owned by another user', () => {
    const otherOwner = { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }

    it('is read from a subfolder on CI', () => {
      const { info, stderr } = runCommitInfo(
        path.join(repo, 'sub'),
        Object.assign({ CI: 'true' }, otherOwner)
      )
      assert.strictEqual(info.sha, sha)
      assert.strictEqual(info.branch, 'main')
      assert.strictEqual(info.remote, 'https://gitlab.com/org/repo.git')
      assert.strictEqual(stderr, '')
    })

    it('is read on Jenkins, which does not set CI', () => {
      const { info, stderr } = runCommitInfo(
        repo,
        Object.assign(
          {
            JENKINS_URL: 'https://jenkins.example.com/',
            GIT_COMMIT: 'jenkins-sha'
          },
          otherOwner
        )
      )
      assert.strictEqual(info.sha, sha)
      assert.strictEqual(info.branch, 'main')
      assert.strictEqual(stderr, '')
    })

    it('is not read outside CI', () => {
      const { info } = runCommitInfo(repo, otherOwner)
      assert.strictEqual(info.sha, null)
    })
  })
})
