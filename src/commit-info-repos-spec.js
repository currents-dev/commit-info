'use strict'

/* eslint-env mocha */
const assert = require('assert')
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TOKEN = 'glcbt-64_SECRET_TOKEN'
const GITLAB_REMOTE = `https://gitlab-ci-token:${TOKEN}@gitlab.com/org/repo.git`

// No global or system git config, because those can mark every repository
// as safe, as the GitHub Actions runner does
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
 * runs the tests do not apply and each test can get its warning.
 * Resolves with the result and everything the process printed.
 */
function runCommitInfo (cwd, env, folder) {
  const script = `require(${JSON.stringify(__dirname)}).commitInfo(${
    folder ? JSON.stringify(folder) : ''
  })
    .then(info => console.log(JSON.stringify(info)))`
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd,
    encoding: 'utf8',
    env: Object.assign(
      { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
      env
    )
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

  it('takes the branch from CI for a detached checkout', () => {
    git(repo, 'checkout', '-q', '--detach')
    const { info } = runCommitInfo(repo, {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: 'refs/pull/12/merge',
      GITHUB_REF_NAME: '12/merge',
      GITHUB_HEAD_REF: 'feature/x',
      GITHUB_SHA: 'ci-sha'
    })
    assert.strictEqual(info.branch, 'feature/x')
    assert.strictEqual(info.sha, sha)
  })

  it('prefers the git branch to the CI branch', () => {
    const { info } = runCommitInfo(repo, {
      TF_BUILD: 'True',
      AZURE_HTTP_USER_AGENT: 'agent',
      BUILD_SOURCEBRANCH: 'refs/heads/other'
    })
    assert.strictEqual(info.branch, 'main')
  })

  it('prefers COMMIT_INFO_BRANCH to git and keeps it as it is', () => {
    const { info } = runCommitInfo(repo, {
      COMMIT_INFO_BRANCH: 'refs/heads/from-env'
    })
    assert.strictEqual(info.branch, 'refs/heads/from-env')
  })

  describe('remote', () => {
    const azureEnv = {
      TF_BUILD: 'True',
      AZURE_HTTP_USER_AGENT: 'agent',
      BUILD_REPOSITORY_URI: 'https://org@dev.azure.com/org/p/_git/repo'
    }

    it('comes from the CI provider before git', () => {
      const { info } = runCommitInfo(repo, azureEnv)
      assert.strictEqual(info.remote, 'https://dev.azure.com/org/p/_git/repo')
    })

    it('comes from git when the CI provider has no remote', () => {
      const { info } = runCommitInfo(repo, {
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/heads/main'
      })
      assert.strictEqual(info.remote, 'https://gitlab.com/org/repo.git')
    })

    it('comes from COMMIT_INFO_REMOTE before the CI provider', () => {
      const { info } = runCommitInfo(
        repo,
        Object.assign(
          { COMMIT_INFO_REMOTE: 'git@github.com:o/r.git' },
          azureEnv
        )
      )
      assert.strictEqual(info.remote, 'git@github.com:o/r.git')
    })
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

    it('are removed from the CI remote when there is no repository', () => {
      const { info, output } = runCommitInfo(root, gitlabEnv)
      assert.strictEqual(info.remote, 'https://gitlab.com/org/repo.git')
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

  it('warns once when git is not in PATH', () => {
    const { info, stderr } = runCommitInfo(repo, { PATH: root })
    assert.strictEqual(info.sha, null)
    assert.strictEqual(info.branch, null)
    assert.strictEqual(info.remote, null)
    assert(stderr.includes('git was not found in PATH'), stderr)
    assert.strictEqual(stderr.match(/\[commit-info\]/g).length, 1, stderr)
  })

  describe('a folder that does not exist', () => {
    it('says so on CI', () => {
      const missing = path.join(root, 'missing')
      const { info, stderr } = runCommitInfo(root, { CI: 'true' }, missing)
      assert.strictEqual(info.sha, null)
      assert(stderr.includes(`${missing} does not exist`), stderr)
      assert(!stderr.includes('git was not found'), stderr)
    })

    it('does not warn outside CI', () => {
      const missing = path.join(root, 'missing')
      const { stderr } = runCommitInfo(root, {}, missing)
      assert.strictEqual(stderr, '')
    })
  })

  describe('no repository', () => {
    it('warns when CI variables do not fill the fields', () => {
      const { info, stderr } = runCommitInfo(root, {
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: sha
      })
      assert.strictEqual(info.branch, 'main')
      assert.strictEqual(info.sha, sha)
      assert.strictEqual(info.message, null)
      assert(/git failed in .*not a git repository/i.test(stderr), stderr)
      assert(
        stderr.includes(
          'Set COMMIT_INFO_MESSAGE, COMMIT_INFO_AUTHOR, COMMIT_INFO_EMAIL'
        ),
        stderr
      )
      assert.strictEqual(stderr.match(/git failed/g).length, 1, stderr)
    })

    it('does not warn outside CI', () => {
      const { info, stderr } = runCommitInfo(root, {})
      assert.strictEqual(info.sha, null)
      assert.strictEqual(stderr, '')
    })

    it('does not warn when CI variables fill the fields', () => {
      const { info, stderr } = runCommitInfo(root, {
        BUILDKITE: 'true',
        BUILDKITE_BRANCH: 'main',
        BUILDKITE_COMMIT: sha,
        BUILDKITE_MESSAGE: 'feat: first',
        BUILDKITE_BUILD_CREATOR: 'Jane',
        BUILDKITE_BUILD_CREATOR_EMAIL: 'jane@example.com'
      })
      assert.strictEqual(info.sha, sha)
      assert.strictEqual(info.author, 'Jane')
      assert.strictEqual(stderr, '')
    })
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

    it('is not read outside CI, with a warning', () => {
      const { info, stderr } = runCommitInfo(repo, otherOwner)
      assert.strictEqual(info.sha, null)
      assert(stderr.includes('dubious ownership'), stderr)
      assert(stderr.includes('safe.directory'), stderr)
      assert(stderr.includes('COMMIT_INFO_SHA'), stderr)
    })
  })
})
