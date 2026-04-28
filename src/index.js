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
  enrichAzurePullRequestCi,
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
    pullRequestCi
  }).then(info => {
    const finish = prCi => {
      const next = {
        ...info,
        pullRequestCi: prCi,
        ghaEventData:
          prCi && prCi.provider === PROVIDER_GITHUB_ACTIONS
            ? withoutProvider(prCi)
            : undefined,
        adoEventData:
          prCi && prCi.provider === PROVIDER_AZURE_PIPELINES
            ? withoutProvider(prCi)
            : undefined
      }
      const envVariables = getCommitInfoFromEnvironment()
      debug('git commit: %o', next)
      debug('env commit: %o', envVariables)
      return mergeWith(or, envVariables, next)
    }
    if (
      info.pullRequestCi &&
      info.pullRequestCi.provider === PROVIDER_AZURE_PIPELINES
    ) {
      return enrichAzurePullRequestCi(info.pullRequestCi, process.env).then(
        finish
      )
    }
    return finish(info.pullRequestCi)
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
