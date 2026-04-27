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
  getRemoteOrigin
} = require('./git-api')
const { getBranch, getCommitInfoFromEnvironment } = require('./utils')
const {
  resolvePullRequestCi,
  PROVIDER_GITHUB_ACTIONS,
  PROVIDER_AZURE_PIPELINES,
  withoutProvider
} = require('./pull-request-ci')
const Promise = require('bluebird')
const { mergeWith, or } = require('ramda')

function commitInfo (folder, options = {}) {
  folder = folder || process.cwd()
  const { pullRequestProvider = 'auto' } = options
  debug('commit-info in folder', folder)

  const pullRequestCi = resolvePullRequestCi({
    env: process.env,
    provider: pullRequestProvider
  })

  return Promise.props({
    branch: getBranch(folder),
    message: getMessage(folder),
    email: getEmail(folder),
    author: getAuthor(folder),
    sha: getSha(folder),
    timestamp: getTimestamp(folder),
    remote: getRemoteOrigin(folder),
    pullRequestCi,
    ghaEventData:
      pullRequestCi && pullRequestCi.provider === PROVIDER_GITHUB_ACTIONS
        ? withoutProvider(pullRequestCi)
        : undefined,
    adoEventData:
      pullRequestCi && pullRequestCi.provider === PROVIDER_AZURE_PIPELINES
        ? withoutProvider(pullRequestCi)
        : undefined
  }).then(info => {
    const envVariables = getCommitInfoFromEnvironment()
    debug('git commit: %o', info)
    debug('env commit: %o', envVariables)
    return mergeWith(or, envVariables, info)
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
  resolvePullRequestCi,
  PROVIDER_GITHUB_ACTIONS,
  PROVIDER_AZURE_PIPELINES
}
