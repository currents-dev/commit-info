'use strict'

const http = require('http')
const https = require('https')

const debug = require('debug')('commit-info')

const PROVIDER_GITHUB_ACTIONS = 'github-actions'
const PROVIDER_AZURE_PIPELINES = 'azure-pipelines'

function withoutProvider (record) {
  if (!record) return
  const rest = {}
  const keys = Object.keys(record)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key !== 'provider') {
      rest[key] = record[key]
    }
  }
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
  const trimmed = msg.trim()
  // Git default merge message on PR refs — not the PR title in Azure DevOps UI.
  if (/^Merge pull request \d+ from .+ into .+$/i.test(trimmed)) {
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

function adoAccessTokenFromEnv (env) {
  return (
    env.SYSTEM_ACCESSTOKEN ||
    env.SYSTEM_ACCESS_TOKEN ||
    env.ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN ||
    null
  )
}

function adoGetPullRequestApiUrl (env) {
  const collectionUri = env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI
  const teamProject = env.SYSTEM_TEAMPROJECT
  const repositoryId = env.BUILD_REPOSITORY_ID
  const pullRequestId = env.SYSTEM_PULLREQUEST_PULLREQUESTID
  if (!collectionUri || !teamProject || !repositoryId || !pullRequestId) {
    return null
  }
  const root = collectionUri.replace(/\/$/, '')
  return `${root}/${encodeURIComponent(
    teamProject
  )}/_apis/git/repositories/${encodeURIComponent(
    repositoryId
  )}/pullRequests/${encodeURIComponent(pullRequestId)}?api-version=7.0`
}

function httpGetJson (href, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(href)
    const lib = u.protocol === 'https:' ? https : http
    const defaultPort = u.protocol === 'https:' ? 443 : 80
    const port = u.port ? parseInt(u.port, 10) : defaultPort
    const opts = {
      hostname: u.hostname,
      port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      }
    }
    const req = lib.request(opts, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        body += chunk
      })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body))
          } catch (err) {
            reject(err)
          }
        } else {
          reject(
            new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 240))
          )
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Optional: richer prTitle / createdBy from Git REST when token + repo id exist.
 * Never throws; on any failure returns the original ci unchanged.
 * @param {object | undefined} ci
 * @param {NodeJS.ProcessEnv} env
 * @param {{ fetchJson?: (href: string, token: string) => Promise<object> }} [options]
 */
function enrichAzurePullRequestCi (ci, env, options = {}) {
  if (!ci || ci.provider !== PROVIDER_AZURE_PIPELINES) {
    return Promise.resolve(ci)
  }
  let token
  let href
  try {
    token = adoAccessTokenFromEnv(env)
    href = adoGetPullRequestApiUrl(env)
  } catch (e) {
    debug('ADO PR REST enrich skipped: %s', e.message)
    return Promise.resolve(ci)
  }
  const fetchJson = options.fetchJson || httpGetJson
  if (!token || !href) {
    return Promise.resolve(ci)
  }
  return fetchJson(href, token)
    .then(data => {
      try {
        const createdBy = data && data.createdBy ? data.createdBy : {}
        return {
          ...ci,
          prTitle:
            data && data.title != null && String(data.title) !== ''
              ? data.title
              : ci.prTitle,
          senderAvatarUrl: createdBy.imageUrl || ci.senderAvatarUrl,
          senderHtmlUrl: createdBy.url || ci.senderHtmlUrl
        }
      } catch (e) {
        debug('ADO PR REST enrich parse error: %s', e.message)
        return ci
      }
    })
    .catch(err => {
      debug('ADO PR REST enrich failed: %s', err.message)
      return ci
    })
}

module.exports = {
  PROVIDER_GITHUB_ACTIONS,
  PROVIDER_AZURE_PIPELINES,
  withoutProvider,
  adoPrTitleFromEnv,
  adoSenderHtmlUrl,
  adoSenderAvatarUrl,
  adoGetPullRequestApiUrl,
  enrichAzurePullRequestCi,
  readGithubActionsPullRequest,
  readAzurePipelinesPullRequest,
  resolvePullRequestCi
}
