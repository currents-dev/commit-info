'use strict'

/* eslint-env mocha */
const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const mockedEnv = require('mocked-env')
const {
  execGit,
  isCi,
  isDubiousOwnership,
  describeGitError
} = require('./run-git')

describe('isCi', () => {
  it('reads CI', () => {
    assert.strictEqual(isCi({ CI: 'true' }), true)
    assert.strictEqual(isCi({ CI: '1' }), true)
    assert.strictEqual(isCi({}), false)
  })

  it('is false for CI=false and CI=0', () => {
    assert.strictEqual(isCi({ CI: 'false' }), false)
    assert.strictEqual(isCi({ CI: '0' }), false)
  })

  it('ignores gcloud and Jenkins variables that a developer shell sets', () => {
    assert.strictEqual(isCi({ GOOGLE_CLOUD_PROJECT: 'my-project' }), false)
    assert.strictEqual(isCi({ GCP_PROJECT: 'my-project' }), false)
    assert.strictEqual(isCi({ GCLOUD_PROJECT: 'my-project' }), false)
    assert.strictEqual(isCi({ JENKINS_HOME: '/var/jenkins_home' }), false)
  })

  it('is true on a CI provider that does not set CI', () => {
    assert.strictEqual(
      isCi({ JENKINS_URL: 'https://jenkins.example.com' }),
      true
    )
  })
})

describe('isDubiousOwnership', () => {
  it('matches the message of git 2.38.0 and later', () => {
    assert(
      isDubiousOwnership({
        stderr: "fatal: detected dubious ownership in repository at '/w/repo'"
      })
    )
  })

  it('matches the message of git 2.35.2 to 2.37.x', () => {
    assert(
      isDubiousOwnership({
        stderr: "fatal: unsafe repository ('/w/repo' is owned by someone else)"
      })
    )
  })

  it('does not match other errors', () => {
    assert(!isDubiousOwnership({ stderr: 'fatal: not a git repository' }))
    assert(!isDubiousOwnership(null))
  })
})

describe('describeGitError', () => {
  it('keeps the first line without credentials', () => {
    const error = {
      stderr:
        "fatal: unable to access 'https://gitlab-ci-token:SECRET@gitlab.com/o/r.git/': 403\n" +
        'second line'
    }
    assert.strictEqual(
      describeGitError(error),
      "fatal: unable to access 'https://gitlab.com/o/r.git/': 403"
    )
  })

  it('uses the message when there is no stderr', () => {
    assert.strictEqual(
      describeGitError(new Error('spawn git ENOENT')),
      'spawn git ENOENT'
    )
  })
})

describe('execGit', function () {
  this.timeout(10000)

  let root, home, restoreEnvironment

  // No global or system git config, because those can mark every repository
  // as safe, as the GitHub Actions runner does
  const env = extra =>
    mockedEnv(
      Object.assign(
        {
          PATH: process.env.PATH,
          HOME: home,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TEST_ASSUME_DIFFERENT_OWNER: '1'
        },
        extra
      ),
      { clear: true }
    )

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-git-'))
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'run-git-home-'))
    execFileSync('git', ['init', '-q', root])
  })

  after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  afterEach(() => {
    restoreEnvironment()
  })

  const showTopLevel = options =>
    execGit(root, ['rev-parse', '--show-toplevel'], options)

  it('retries a read-only command on CI when another user owns the repository', async () => {
    restoreEnvironment = env({ CI: 'true' })
    assert.strictEqual(
      fs.realpathSync(await showTopLevel({ readOnly: true })),
      fs.realpathSync(root)
    )
  })

  it('retries on a CI provider that does not set CI', async () => {
    restoreEnvironment = env({ JENKINS_URL: 'https://jenkins.example.com' })
    assert.strictEqual(
      fs.realpathSync(await showTopLevel({ readOnly: true })),
      fs.realpathSync(root)
    )
  })

  it('retries in a Jenkins job', async () => {
    restoreEnvironment = env({
      JENKINS_URL: 'https://jenkins.example.com/',
      JENKINS_HOME: '/var/jenkins_home',
      BUILD_ID: '12',
      BUILD_NUMBER: '12'
    })
    assert.strictEqual(
      fs.realpathSync(await showTopLevel({ readOnly: true })),
      fs.realpathSync(root)
    )
  })

  it('retries in a Google Cloud Build job', async () => {
    restoreEnvironment = env({
      BUILD_ID: '7b3a9e2c-1f0d-4c3e-9a5b-2d8f6e4c1a0b',
      PROJECT_ID: 'my-project',
      PROJECT_NUMBER: '123456789012'
    })
    assert.strictEqual(
      fs.realpathSync(await showTopLevel({ readOnly: true })),
      fs.realpathSync(root)
    )
  })

  it('does not retry in a shell with GOOGLE_CLOUD_PROJECT', async () => {
    restoreEnvironment = env({ GOOGLE_CLOUD_PROJECT: 'my-project' })
    await assert.rejects(showTopLevel({ readOnly: true }), isDubiousOwnership)
  })

  it('does not retry in a shell with JENKINS_HOME', async () => {
    restoreEnvironment = env({ JENKINS_HOME: '/var/jenkins_home' })
    await assert.rejects(showTopLevel({ readOnly: true }), isDubiousOwnership)
  })

  it('does not retry other commands, such as fetch', async () => {
    restoreEnvironment = env({ CI: 'true' })
    await assert.rejects(showTopLevel(), isDubiousOwnership)
  })

  it('does not retry outside CI', async () => {
    restoreEnvironment = env({})
    await assert.rejects(showTopLevel({ readOnly: true }), isDubiousOwnership)
  })
})

describe('execGit output and errors', function () {
  this.timeout(20000)

  let root, home, restoreEnvironment

  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      env: Object.assign({}, process.env, {
        GIT_AUTHOR_NAME: 'Zoë Ångström',
        GIT_AUTHOR_EMAIL: 'zoe@example.com',
        GIT_COMMITTER_NAME: 'Zoë Ångström',
        GIT_COMMITTER_EMAIL: 'zoe@example.com'
      })
    })

  const commitVerbatim = message => {
    const file = path.join(home, 'message')
    fs.writeFileSync(file, message)
    git('commit', '-q', '--allow-empty', '--cleanup=verbatim', '-F', file)
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-git-'))
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-git-home-'))
    git('init', '-q')
    restoreEnvironment = mockedEnv(
      { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
      { clear: true }
    )
  })

  afterEach(() => {
    restoreEnvironment()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('removes only the last newline of stdout', async () => {
    commitVerbatim('feat: ünïcödé 🚀\r\n\r\nbody\n\n')
    assert.strictEqual(
      await execGit(root, ['show', '-s', '--pretty=%B']),
      'feat: ünïcödé 🚀\r\n\r\nbody\n\n'
    )
    assert.strictEqual(
      await execGit(root, ['show', '-s', '--pretty=%an']),
      'Zoë Ångström'
    )
  })

  it('rejects with the exit code, the output and the command', async () => {
    commitVerbatim('m')
    await assert.rejects(execGit(root, ['show', '-s', 'nope']), error => {
      assert.strictEqual(error.code, 128)
      assert.strictEqual(error.stdout, '')
      assert(error.stderr.startsWith('fatal: ambiguous argument'), error.stderr)
      assert.strictEqual(
        error.message,
        `Command failed: git show -s nope\n${error.stderr}\n`
      )
      assert.strictEqual(error.timedOut, false)
      return true
    })
  })

  it('rejects with ENOENT when git is not in PATH', async () => {
    restoreEnvironment()
    restoreEnvironment = mockedEnv({ PATH: home }, { clear: true })
    await assert.rejects(execGit(root, ['rev-parse', 'HEAD']), {
      code: 'ENOENT',
      message: 'spawn git ENOENT'
    })
  })

  it('passes the environment and turns off the terminal prompt', async () => {
    restoreEnvironment()
    restoreEnvironment = mockedEnv(
      { PATH: process.env.PATH, HOME: home, MY_VARIABLE: 'kept' },
      { clear: true }
    )
    const printenv = name =>
      execGit(root, ['-c', `alias.env=!printenv ${name}`, 'env'])
    assert.strictEqual(await printenv('GIT_TERMINAL_PROMPT'), '0')
    assert.strictEqual(await printenv('MY_VARIABLE'), 'kept')
  })

  it('rejects when stdout is over 10 MB, as execa did', async () => {
    commitVerbatim('x'.repeat(10500000))
    await assert.rejects(execGit(root, ['show', '-s', '--pretty=%B']), {
      message: 'stdout maxBuffer exceeded'
    })
  })
})
