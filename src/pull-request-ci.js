'use strict'

const debug = require('debug')('commit-info')

const PROVIDER_GITHUB_ACTIONS = 'github-actions'
const PROVIDER_AZURE_PIPELINES = 'azure-pipelines'

function withoutProvider (record) {
  if (!record) return
  const { provider, ...rest } = record
  return rest
}

/**
 * Azure Repos PR builds rarely set SYSTEM_PULLREQUEST_TITLE; merge commit message
 * is usually "Merged PR {id}: {title}" (first line only in BUILD_SOURCEVERSIONMESSAGE).
 * @param {NodeJS.ProcessEnv} env
 */
function adoPrTitleFromEnv (env) {
  const explicit = env.SYSTEM_PULLREQUEST_TITLE
  if (explicit) {
    return explicit
  }
  const msg = env.BUILD_SOURCEVERSIONMESSAGE
  if (!msg) {
    return null
  }
  const merged = msg.match(/^Merged PR \d+: ?(.*)$/)
  if (merged) {
    return merged[1] || null
  }
  return msg
}

/**
 * @param {string | null | undefined} collectionUri
 * @param {string | null | undefined} userId Build.RequestedForId
 */
function adoSenderHtmlUrl (collectionUri, userId) {
  if (!collectionUri || !userId) {
    return null
  }
  const root = collectionUri.replace(/\/$/, '')
  return `${root}/_usersSettings/about?userId=${encodeURIComponent(userId)}`
}

/**
 * Graph profile avatar (may require auth to fetch; same pattern as ADO UI).
 * @param {string | null | undefined} collectionUri
 * @param {string | null | undefined} userId Build.RequestedForId
 */
function adoSenderAvatarUrl (collectionUri, userId) {
  if (!collectionUri || !userId) {
    return null
  }
  const root = collectionUri.replace(/\/$/, '')
  return `${root}/_apis/GraphProfile/MemberAvatars/${encodeURIComponent(
    userId
  )}?size=2&api-version=5.1-preview.1`
}

/**
 * @param {string} eventFilePath
 * @param {string | undefined} isGha
 * @param {typeof import('fs')} fs
 */
function readGithubActionsPullRequest (eventFilePath, isGha, fs) {
  try {
    if (!eventFilePath || isGha !== 'true') {
      return
    }

    debug('Retreiving GitHub Actions data from %s', eventFilePath)
    const data = JSON.parse(fs.readFileSync(eventFilePath))

    return {
      provider: PROVIDER_GITHUB_ACTIONS,
      headRef: data.pull_request.head.ref,
      headSha: data.pull_request.head.sha,
      baseRef: data.pull_request.base.ref,
      baseSha: data.pull_request.base.sha,
      issueUrl: data.pull_request.issue_url,
      htmlUrl: data.pull_request.html_url,
      prTitle: data.pull_request.title,
      senderAvatarUrl: data.sender.avatar_url,
      senderHtmlUrl: data.sender.html_url
    }
  } catch (e) {
    debug('Retreiving GitHub Actions data error: %s', e)
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
function readAzurePipelinesPullRequest (env) {
  try {
    if (env.BUILD_REASON !== 'PullRequest') {
      return
    }

    const pullRequestNumber = env.SYSTEM_PULLREQUEST_PULLREQUESTID
    if (!pullRequestNumber) {
      return
    }

    const headRef = env.SYSTEM_PULLREQUEST_SOURCEBRANCH || null
    const baseRef = env.SYSTEM_PULLREQUEST_TARGETBRANCH || null
    const headSha =
      env.SYSTEM_PULLREQUEST_SOURCECOMMITID || env.BUILD_SOURCEVERSION || null
    const baseSha = env.SYSTEM_PULLREQUEST_TARGETCOMMITID || null
    const buildSourceBranch = env.BUILD_SOURCEBRANCH || null

    let htmlUrl = null
    const collectionUri = env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI
    const teamProject = env.SYSTEM_TEAMPROJECT
    const repositoryName = env.BUILD_REPOSITORY_NAME
    if (collectionUri && teamProject && repositoryName) {
      const base = collectionUri.replace(/\/$/, '')
      htmlUrl = `${base}/${encodeURIComponent(
        teamProject
      )}/_git/${encodeURIComponent(
        repositoryName
      )}/pullrequest/${pullRequestNumber}`
    }

    // pullRequestId: canonical PR URL only; null if env cannot build it (no numeric fallback).
    const pullRequestId = htmlUrl
    const requestedForId = env.BUILD_REQUESTEDFORID || null

    return {
      provider: PROVIDER_AZURE_PIPELINES,
      pullRequestId,
      pullRequestNumber,
      buildSourceBranch,
      headRef,
      headSha,
      baseRef,
      baseSha,
      issueUrl: null,
      htmlUrl,
      prTitle: adoPrTitleFromEnv(env),
      senderAvatarUrl: adoSenderAvatarUrl(collectionUri, requestedForId),
      senderHtmlUrl: adoSenderHtmlUrl(collectionUri, requestedForId)
    }
  } catch (e) {
    debug('Retrieving Azure DevOps PR data error: %s', e)
  }
}

/**
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof import('fs')} [opts.fs]
 * @param {string} [opts.githubEventPath]
 * @param {string | undefined} [opts.githubActions]
 * @param {'auto' | typeof PROVIDER_GITHUB_ACTIONS | typeof PROVIDER_AZURE_PIPELINES} [opts.provider]
 */
function resolvePullRequestCi ({
  env = process.env,
  fs = require('fs'),
  githubEventPath = env.GITHUB_EVENT_PATH,
  githubActions = env.GITHUB_ACTIONS,
  provider = 'auto'
} = {}) {
  if (provider === 'auto' || provider === PROVIDER_GITHUB_ACTIONS) {
    const gha = readGithubActionsPullRequest(githubEventPath, githubActions, fs)
    if (gha) {
      return gha
    }
    if (provider === PROVIDER_GITHUB_ACTIONS) {
      return
    }
  }

  if (provider === 'auto' || provider === PROVIDER_AZURE_PIPELINES) {
    return readAzurePipelinesPullRequest(env)
  }
}

module.exports = {
  PROVIDER_GITHUB_ACTIONS,
  PROVIDER_AZURE_PIPELINES,
  withoutProvider,
  adoPrTitleFromEnv,
  adoSenderHtmlUrl,
  adoSenderAvatarUrl,
  readGithubActionsPullRequest,
  readAzurePipelinesPullRequest,
  resolvePullRequestCi
}
