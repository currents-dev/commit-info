'use strict'

/* global describe, it, beforeAll, afterAll, beforeEach, afterEach */
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

describe('execGit', { timeout: 10000 }, () => {
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

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-git-'))
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'run-git-home-'))
    execFileSync('git', ['init', '-q', root])
  })

  afterAll(() => {
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

const waitFor = async condition => {
  for (let i = 0; i < 100 && !condition(); i++) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return condition()
}

describe('execGit output and errors', { timeout: 20000 }, () => {
  let root, home, restoreEnvironment, exitListeners

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
    exitListeners = process.listenerCount('exit')
    restoreEnvironment = mockedEnv(
      { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
      { clear: true }
    )
  })

  afterEach(async () => {
    restoreEnvironment()
    // After 'rejects when stdout is over 10 MB' git runs until it finds the
    // closed pipe. Its exit listener would break the listener count in 'adds
    // one exit listener while git runs and removes it after'.
    await waitFor(() => process.listenerCount('exit') === exitListeners)
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

describe('git processes when Node exits', { timeout: 20000 }, () => {
  let root, restoreEnvironment

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-git-exit-'))
    // a git that writes its process ID and waits
    fs.writeFileSync(
      path.join(root, 'git'),
      '#!/bin/sh\necho $$ >> "$PID_FILE"\nexec sleep 30\n',
      { mode: 0o755 }
    )
  })

  afterEach(() => {
    if (restoreEnvironment) {
      restoreEnvironment()
      restoreEnvironment = null
    }
    fs.rmSync(root, { recursive: true, force: true })
  })

  const isRunning = pid => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return false
    }
  }

  const readPids = pidFile =>
    fs.existsSync(pidFile)
      ? fs
        .readFileSync(pidFile, 'utf8')
        .trim()
        .split('\n')
        .map(Number)
      : []

  // the child process runs two git commands and ends as `ending` says
  const runAndEnd = ending => {
    const pidFile = path.join(root, 'pids')
    const runGit = JSON.stringify(require.resolve('./run-git'))
    const script = `
      const { execGit } = require(${runGit})
      const fs = require('fs')
      execGit(${JSON.stringify(root)}, ['status']).catch(() => {})
      execGit(${JSON.stringify(root)}, ['log']).catch(() => {})
      const timer = setInterval(() => {
        const pids = fs.existsSync(process.env.PID_FILE)
          ? fs.readFileSync(process.env.PID_FILE, 'utf8').trim().split('\\n')
          : []
        if (pids.length === 2) {
          clearInterval(timer)
          ${ending}
        }
      }, 20)`
    const child = require('child_process').spawnSync(
      process.execPath,
      ['-e', script],
      {
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          PATH: `${root}:${process.env.PATH}`,
          PID_FILE: pidFile
        })
      }
    )
    return { child, pids: readPids(pidFile) }
  }

  it('kills the running git processes on process.exit()', async () => {
    const { pids } = runAndEnd('process.exit(0)')
    assert.strictEqual(pids.length, 2)
    assert(await waitFor(() => !pids.some(isRunning)), `running: ${pids}`)
  })

  it('kills the running git processes on an uncaught error', async () => {
    const { child, pids } = runAndEnd("throw new Error('uncaught')")
    assert.strictEqual(child.status, 1, child.stderr)
    assert.strictEqual(pids.length, 2)
    assert(await waitFor(() => !pids.some(isRunning)), `running: ${pids}`)
  })

  it('adds one exit listener while git runs and removes it after', async () => {
    restoreEnvironment = mockedEnv({
      PATH: `${root}:${process.env.PATH}`,
      PID_FILE: path.join(root, 'pids')
    })
    const listeners = process.listenerCount('exit')
    const runs = [
      execGit(root, ['status'], { timeout: 5000 }),
      execGit(root, ['log'], { timeout: 5000 })
    ].map(run => run.catch(e => e))
    assert(await waitFor(() => readPids(path.join(root, 'pids')).length === 2))
    assert.strictEqual(process.listenerCount('exit'), listeners + 1)
    readPids(path.join(root, 'pids')).forEach(pid => process.kill(pid))
    await Promise.all(runs)
    assert.strictEqual(process.listenerCount('exit'), listeners)
  })
})
