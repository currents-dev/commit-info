'use strict'

const childProcess = require('child_process')
const debug = require('debug')('commit-info')
const { removeCredentialsFromText } = require('./remove-credentials')
const { detectCiProvider } = require('./ci-provider')

// git 2.35.2 and later refuse a repository owned by another user, which is
// common in containers that mount the checkout. Messages:
// - "fatal: unsafe repository ('/w/repo' is owned by someone else)", git
//   2.35.2 to 2.37.x
// - "fatal: detected dubious ownership in repository at '/w/repo'", git 2.38.0
//   and later
const isDubiousOwnership = error =>
  Boolean(error) &&
  /dubious ownership|unsafe repository/.test(
    String(error.stderr || error.message || '')
  )

// detectCiProvider also matches these, which developers often have set in
// their shell: gcloud reads the project variables, and a Jenkins installation
// sets JENKINS_HOME. Jenkins jobs and Google Cloud Build set other variables
// that it matches.
const VARIABLES_SET_OUTSIDE_CI = [
  'GOOGLE_CLOUD_PROJECT',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'JENKINS_HOME'
]

const withoutKeys = (env, keys) => {
  const copy = Object.assign({}, env)
  keys.forEach(key => delete copy[key])
  return copy
}

// A detected CI provider counts too: Jenkins does not set CI
const isCi = (env = process.env) => {
  const ci = env.CI
  return (
    (Boolean(ci) && ci !== 'false' && ci !== '0') ||
    Boolean(detectCiProvider(withoutKeys(env, VARIABLES_SET_OUTSIDE_CI)))
  )
}

/**
 * True when a read-only git command that failed should run again with
 * `-c safe.directory=*`.
 *
 * Only on CI: on a developer machine the check protects against a repository
 * another user planted. `*` and not the folder, because the folder can be a
 * subfolder of the repository, which safe.directory does not match.
 *
 * git 2.35.2 to 2.37.x ignore `-c safe.directory`; they read the setting from
 * the global and system config only, so the retry fails there too.
 */
const shouldRetryWithSafeDirectory = error =>
  isCi() && isDubiousOwnership(error)

const SAFE_DIRECTORY_ARGS = ['-c', 'safe.directory=*']

/**
 * Text of a git error for logs and warnings, without credentials.
 */
const describeGitError = error => {
  if (!error) {
    return ''
  }
  const text = String(error.stderr || error.message || error).trim()
  return removeCredentialsFromText(text.split('\n')[0])
}

// The limit of execa 1.0, which ran git before
const MAX_OUTPUT_LENGTH = 1000 * 1000 * 10

const stripFinalNewline = text => text.replace(/\n$/, '').replace(/\r$/, '')

// The git processes that run now. They are killed when Node exits, as execa 1.0
// did. A signal that ends Node without an 'exit' event, such as SIGTERM with no
// handler, leaves them running.
const runningChildren = new Set()

const killRunningChildren = () => {
  runningChildren.forEach(child => child.kill())
}

const addRunningChild = child => {
  if (runningChildren.size === 0) {
    process.on('exit', killRunningChildren)
  }
  runningChildren.add(child)
}

const removeRunningChild = child => {
  runningChildren.delete(child)
  if (runningChildren.size === 0) {
    process.removeListener('exit', killRunningChildren)
  }
}

/**
 * Runs `git <args>` and resolves with stdout without the final newline.
 * Rejects with an error that has `code` (the exit code), `stdout`, `stderr`
 * and `timedOut`, as execa 1.0 did.
 *
 * Calls `childProcess.spawn` at run time, so tests can stub it.
 */
function spawnGit (folder, args, timeout) {
  const cmd = ['git'].concat(args).join(' ')
  return new Promise((resolve, reject) => {
    let child
    try {
      child = childProcess.spawn('git', args, {
        cwd: folder,
        env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
      })
    } catch (e) {
      reject(e)
      return
    }
    addRunningChild(child)

    const output = { stdout: '', stderr: '' }
    let openStreams = 0
    let result = null
    let timedOut = false
    let timer = null

    const finish = () => {
      if (openStreams > 0 || !result) {
        return
      }
      const { stdout, stderr } = output
      if (!result.error && result.code === 0 && result.signal === null) {
        resolve(stripFinalNewline(stdout))
        return
      }
      const error =
        result.error ||
        Object.assign(
          new Error(`Command failed: ${cmd}\n${stderr}\n${stdout}`),
          { code: result.code }
        )
      reject(
        Object.assign(error, {
          stdout,
          stderr,
          failed: true,
          signal: result.signal || null,
          cmd,
          timedOut,
          killed: error.killed || child.killed
        })
      )
    }

    const onDone = done => {
      if (result) {
        return
      }
      clearTimeout(timer)
      removeRunningChild(child)
      result = done
      finish()
    }

    const read = name => {
      const stream = child[name]
      if (!stream) {
        return
      }
      openStreams += 1
      let ended = false
      const onEnd = () => {
        if (!ended) {
          ended = true
          openStreams -= 1
          finish()
        }
      }
      stream.setEncoding('utf8')
      stream.on('data', chunk => {
        output[name] += chunk
        if (output[name].length > MAX_OUTPUT_LENGTH) {
          child.stdout.destroy()
          child.stderr.destroy()
          reject(new Error(`${name} maxBuffer exceeded`))
        }
      })
      stream.on('end', onEnd)
      // a destroyed stream closes without 'end'
      stream.on('close', onEnd)
    }

    child.on('exit', (code, signal) => onDone({ code, signal }))
    child.on('error', error => onDone({ error }))
    if (child.stdin) {
      child.stdin.on('error', error => onDone({ error }))
    }
    read('stdout')
    read('stderr')

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeout)
    }
  })
}

/**
 * Runs `git <args>` in the folder and resolves with stdout.
 *
 * @param {string} folder
 * @param {string[]} args
 * @param {{timeout?: number, readOnly?: boolean}} options readOnly commands
 *   are retried on CI when git refuses the repository's owner
 */
async function execGit (folder, args, options = {}) {
  try {
    return await spawnGit(folder, args, options.timeout)
  } catch (e) {
    if (!options.readOnly || !shouldRetryWithSafeDirectory(e)) {
      throw e
    }
    debug('git %s: dubious ownership, running with safe.directory=*', args[0])
    return spawnGit(folder, SAFE_DIRECTORY_ARGS.concat(args), options.timeout)
  }
}

module.exports = {
  execGit,
  isCi,
  describeGitError,
  isDubiousOwnership,
  SAFE_DIRECTORY_ARGS
}
