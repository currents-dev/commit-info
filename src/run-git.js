'use strict'

const execa = require('execa')
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

/**
 * Runs `git <args>` in the folder and resolves with stdout.
 *
 * @param {string} folder
 * @param {string[]} args
 * @param {{timeout?: number, readOnly?: boolean}} options readOnly commands
 *   are retried on CI when git refuses the repository's owner
 */
async function execGit (folder, args, options = {}) {
  const execaOptions = {
    cwd: folder,
    timeout: options.timeout,
    env: { GIT_TERMINAL_PROMPT: '0' }
  }
  try {
    const { stdout } = await execa('git', args, execaOptions)
    return stdout
  } catch (e) {
    if (!options.readOnly || !shouldRetryWithSafeDirectory(e)) {
      throw e
    }
    debug('git %s: dubious ownership, running with safe.directory=*', args[0])
    const { stdout } = await execa(
      'git',
      SAFE_DIRECTORY_ARGS.concat(args),
      execaOptions
    )
    return stdout
  }
}

module.exports = {
  execGit,
  isCi,
  describeGitError,
  isDubiousOwnership,
  SAFE_DIRECTORY_ARGS
}
