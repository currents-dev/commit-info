'use strict'

const debug = require('debug')('commit-info')
const {
  getSubject,
  getBody,
  getMessage,
  getEmail,
  getAuthor,
  getSha,
  getTimestamp,
  getRemoteOrigin,
  gitCommands,
  runGitCommandWithError,
  readRemoteOrigin,
  checkIfDetached
} = require('./git-api')
const {
  getBranch,
  getCommitInfoFromEnvironment,
  getEnvName,
  getFields,
  getGhaEventData
} = require('./utils')
const { getPullRequestHeadCommit } = require('./pull-request-head')
const { getCiCommitInfo, detectCiProvider } = require('./ci')
const { removeCredentials } = require('./remove-credentials')
const { describeGitError, isCi, isDubiousOwnership } = require('./run-git')
const Promise = require('bluebird')

const GIT_COMMANDS = {
  branch: gitCommands.branch,
  message: gitCommands.message,
  email: gitCommands.email,
  author: gitCommands.author,
  sha: gitCommands.sha,
  timestamp: gitCommands.timestamp
}

// No CI provider sets a timestamp, and many repositories have no remote, so
// missing values there do not cause a warning
const WARN_FIELDS = ['branch', 'sha', 'message', 'author', 'email']

const withoutRemoteCredentials = info =>
  Object.assign({}, info, { remote: removeCredentials(info.remote) })

/**
 * Resolves with `{ info, error }`: the values git returned, and the first
 * error git failed with.
 */
function readGit (folder) {
  const reads = { remote: readRemoteOrigin(folder) }
  Object.keys(GIT_COMMANDS).forEach(field => {
    reads[field] = runGitCommandWithError(GIT_COMMANDS[field], folder)
  })
  return Promise.props(reads).then(results => {
    const info = {}
    let error = null
    getFields().forEach(field => {
      info[field] = results[field].value
      error = error || results[field].error
    })
    info.branch = checkIfDetached(info.branch)
    return { info, error }
  })
}

/**
 * For each field the first value that is set wins:
 * 1. the COMMIT_INFO_* variable
 * 2. git
 * 3. the CI provider's variables
 */
function combineCommitInfo (fromEnvironment, fromGit, fromCi) {
  const combined = {}
  getFields().forEach(field => {
    combined[field] =
      fromEnvironment[field] || fromGit[field] || fromCi[field] || null
  })
  return combined
}

// Playwright workers each call commitInfo; one warning per process is enough
let warned = false

const isNotRepository = error =>
  /not a git repository/i.test(String(error.stderr || error.message || ''))

const isGitMissing = error => error.code === 'ENOENT'

function warnAboutMissingFields (folder, gitError, info) {
  const missing = WARN_FIELDS.filter(field => !info[field])
  if (!gitError || !missing.length || warned) {
    return
  }
  // a command run outside a repository on a developer machine has no commit
  if (isNotRepository(gitError) && !isCi()) {
    return
  }
  warned = true
  const lines = [
    isGitMissing(gitError)
      ? `[commit-info] git was not found in PATH, so the commit in ${folder} could not be read.`
      : `[commit-info] git failed in ${folder}: ${describeGitError(gitError)}`,
    `Missing commit fields: ${missing.join(', ')}. Set ${missing
      .map(getEnvName)
      .join(', ')} to provide them.`
  ]
  if (isDubiousOwnership(gitError)) {
    lines.push(
      "Or allow the repository: git config --global --add safe.directory '*'. " +
        'git 2.35.2 to 2.37.x ignore safe.directory set on the command line.'
    )
  }
  console.warn(lines.join('\n'))
}

/**
 * Resolves with the commit the folder has checked out. The COMMIT_INFO_*
 * variables take priority over git; the CI provider's variables fill the
 * fields git could not read. The remote has no credentials.
 *
 * @param {string} [folder] defaults to the current working directory
 */
function commitInfo (folder) {
  folder = folder || process.cwd()
  debug('commit-info in folder', folder)

  return Promise.props({
    git: readGit(folder),
    ghaEventData: getGhaEventData(
      process.env.GITHUB_EVENT_PATH,
      process.env.GITHUB_ACTIONS
    )
  })
    .then(({ git, ghaEventData }) => {
      // COMMIT_INFO_SHA names the commit to report, so it is used as is
      if (process.env.COMMIT_INFO_SHA) {
        return Object.assign({ ghaEventData }, git)
      }
      return getPullRequestHeadCommit(folder, git.info.sha, ghaEventData).then(
        head => ({
          info: Object.assign({}, git.info, head),
          error: git.error,
          ghaEventData
        })
      )
    })
    .then(({ info: gitInfo, error: gitError, ghaEventData }) => {
      const envVariables = withoutRemoteCredentials(
        getCommitInfoFromEnvironment()
      )
      const ciInfo = getCiCommitInfo()
      debug('git commit: %o', gitInfo)
      debug('env commit: %o', envVariables)
      debug('CI commit: %o', ciInfo)

      const info = combineCommitInfo(envVariables, gitInfo, ciInfo)
      warnAboutMissingFields(folder, gitError, info)
      return Object.assign(info, { ghaEventData })
    })
}

module.exports = {
  commitInfo,
  getBranch,
  getMessage,
  getEmail,
  getAuthor,
  getSha,
  getRemoteOrigin,
  getSubject,
  getTimestamp,
  getBody,
  getCiCommitInfo,
  detectCiProvider,
  removeCredentials
}
