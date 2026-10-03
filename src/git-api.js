const debug = require('debug')('commit-info')
const la = require('lazy-ass')
const is = require('check-more-types')
const Promise = require('bluebird')
const { removeCredentials } = require('./remove-credentials')
const {
  execGit,
  isCi,
  describeGitError,
  SAFE_DIRECTORY_ARGS
} = require('./run-git')

// common git commands for getting basic info
// https://git-scm.com/docs/git-show
const gitCommands = {
  branch: 'git rev-parse --abbrev-ref HEAD',
  message: 'git show -s --pretty=%B',
  subject: 'git show -s --pretty=%s',
  body: 'git show -s --pretty=%b',
  email: 'git show -s --pretty=%ae',
  author: 'git show -s --pretty=%an',
  sha: 'git show -s --pretty=%H',
  timestamp: 'git show -s --pretty=%ct',
  remoteOriginUrl: 'git config --get remote.origin.url'
}

const returnNull = () => null
const returnNullIfEmpty = value => value || null
const keepValue = value => value

// `git config --get` exits with 1 and prints nothing when the key is not set
const isMissingValue = e =>
  typeof e.code === 'number' && !String(e.stderr || '').trim()

// The commands in gitCommands have no quoted arguments
const toArgs = gitCommand => gitCommand.split(' ').slice(1)

/**
 * Runs a read-only git command and resolves with `{ value, error }`. `value`
 * is the trimmed stdout or null; `error` is set when git failed for another
 * reason than a missing value.
 *
 * @param {string} gitCommand one of gitCommands
 * @param {string} [pathToRepo]
 * @param {(stdout: string) => string} [transform] runs before stdout is
 *   logged, so it can remove credentials
 */
const runGitCommandWithError = (gitCommand, pathToRepo, transform) => {
  la(is.unemptyString(gitCommand), 'missing git command', gitCommand)
  la(gitCommand.startsWith('git'), 'invalid git command', gitCommand)

  pathToRepo = pathToRepo || process.cwd()
  la(is.unemptyString(pathToRepo), 'missing repo path', pathToRepo)
  transform = transform || keepValue

  debug('running git command: %s', gitCommand)
  debug('in folder %s', pathToRepo)

  return Promise.try(() =>
    execGit(pathToRepo, toArgs(gitCommand), { readOnly: true })
  )
    .then(transform)
    .tap(stdout => debug('git stdout:', stdout))
    .then(stdout => ({ value: returnNullIfEmpty(stdout), error: null }))
    .catch(e => {
      debug(
        'got an error running command "%s" in folder "%s": %s',
        gitCommand,
        pathToRepo,
        describeGitError(e)
      )
      return { value: null, error: isMissingValue(e) ? null : e }
    })
}

const runGitCommand = (gitCommand, pathToRepo, transform) =>
  runGitCommandWithError(gitCommand, pathToRepo, transform).then(
    result => result.value
  )

/*
  "gift" module returns "" for detached checkouts
  and our current command returns "HEAD"
  and we changed the behavior to return null

  example:
  git checkout <commit sha>
  get git branch returns "HEAD"
*/
const checkIfDetached = branch => (branch === 'HEAD' ? null : branch)

function getGitBranch (pathToRepo) {
  return runGitCommand(gitCommands.branch, pathToRepo)
    .then(checkIfDetached)
    .catch(returnNull)
}

const bindCommand = gitCommand => pathToRepo =>
  runGitCommand(gitCommand, pathToRepo)

const getMessage = bindCommand(gitCommands.message)

const getSubject = bindCommand(gitCommands.subject)

const getBody = bindCommand(gitCommands.body)

const getEmail = bindCommand(gitCommands.email)

const getAuthor = bindCommand(gitCommands.author)

const getSha = bindCommand(gitCommands.sha)

const getTimestamp = bindCommand(gitCommands.timestamp)

// Reads the repository's config when another user owns the repository
const remoteOriginUrlOfAnyOwner = gitCommands.remoteOriginUrl.replace(
  /^git /,
  `git ${SAFE_DIRECTORY_ARGS.join(' ')} `
)

/**
 * Reads the remote URL without credentials: a remote can hold a token, as in
 * https://user:<token>@host/o/r.git. Resolves with `{ value, error }`.
 *
 * In a repository owned by another user `git config` does not fail: it skips
 * the repository's config and prints nothing. So on CI an empty result is read
 * again with safe.directory=*.
 */
const readRemoteOrigin = pathToRepo =>
  runGitCommandWithError(
    gitCommands.remoteOriginUrl,
    pathToRepo,
    removeCredentials
  ).then(result => {
    if (result.value || result.error || !isCi()) {
      return result
    }
    return runGitCommandWithError(
      remoteOriginUrlOfAnyOwner,
      pathToRepo,
      removeCredentials
    ).then(retry => (retry.error ? result : retry))
  })

const getRemoteOrigin = pathToRepo =>
  readRemoteOrigin(pathToRepo).then(result => result.value)

module.exports = {
  runGitCommand,
  runGitCommandWithError,
  getGitBranch,
  getSubject,
  getBody,
  getMessage,
  getEmail,
  getAuthor,
  getSha,
  getTimestamp,
  getRemoteOrigin,
  readRemoteOrigin,
  gitCommands
}
