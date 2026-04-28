'use strict'

/* eslint-env mocha */
const la = require('lazy-ass')
const sinon = require('sinon')
const fs = require('fs')
const {
  resolvePullRequestCi,
  PROVIDER_GITHUB_ACTIONS,
  PROVIDER_AZURE_PIPELINES,
  readGithubActionsPullRequest,
  adoPrTitleFromEnv,
  adoGetPullRequestApiUrl,
  enrichAzurePullRequestCi
} = require('./pull-request-ci')

describe('pull-request-ci', () => {
  const githubEvent = {
    pull_request: {
      head: { ref: 'head-ref', sha: 'head-sha' },
      base: { ref: 'base-ref', sha: 'base-sha' },
      issue_url: 'issue',
      html_url: 'html',
      title: 'title'
    },
    sender: {
      avatar_url: 'av',
      html_url: 'sender'
    }
  }

  describe('resolvePullRequestCi', () => {
    let readStub

    beforeEach(() => {
      readStub = sinon
        .stub(fs, 'readFileSync')
        .returns(JSON.stringify(githubEvent))
    })

    afterEach(() => {
      readStub.restore()
    })

    it('auto prefers GitHub Actions when event file is present', () => {
      const r = resolvePullRequestCi({
        env: {
          GITHUB_ACTIONS: 'true',
          GITHUB_EVENT_PATH: '/tmp/event.json',
          BUILD_REASON: 'PullRequest',
          SYSTEM_PULLREQUEST_PULLREQUESTID: '99'
        },
        fs,
        provider: 'auto'
      })

      la(r.provider === PROVIDER_GITHUB_ACTIONS, r)
      la(r.headRef === 'head-ref', r)
    })

    it('auto falls back to Azure when GitHub is not active', () => {
      const r = resolvePullRequestCi({
        env: {
          BUILD_REASON: 'PullRequest',
          SYSTEM_PULLREQUEST_PULLREQUESTID: '7',
          SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/f'
        },
        fs,
        provider: 'auto'
      })

      la(r.provider === PROVIDER_AZURE_PIPELINES, r)
      la(r.pullRequestNumber === '7', r)
      la(r.pullRequestId == null, r)
    })

    it('github-actions skips Azure even if ADO vars are set', () => {
      const r = resolvePullRequestCi({
        env: {
          GITHUB_ACTIONS: 'true',
          GITHUB_EVENT_PATH: '/tmp/event.json',
          BUILD_REASON: 'PullRequest',
          SYSTEM_PULLREQUEST_PULLREQUESTID: '99'
        },
        fs,
        provider: PROVIDER_GITHUB_ACTIONS
      })

      la(r.provider === PROVIDER_GITHUB_ACTIONS, r)
    })

    it('azure-pipelines ignores GitHub event file', () => {
      const r = resolvePullRequestCi({
        env: {
          GITHUB_ACTIONS: 'true',
          GITHUB_EVENT_PATH: '/tmp/event.json',
          BUILD_REASON: 'PullRequest',
          SYSTEM_PULLREQUEST_PULLREQUESTID: '3'
        },
        fs,
        provider: PROVIDER_AZURE_PIPELINES
      })

      la(r.provider === PROVIDER_AZURE_PIPELINES, r)
      la(r.pullRequestNumber === '3', r)
      la(r.pullRequestId == null, r)
      la(readStub.called === false, 'should not read GitHub event JSON')
    })

    it('azure-pipelines pullRequestId is htmlUrl when collection/project/repo are set', () => {
      const url = 'https://dev.azure.com/acme/P/_git/r/pullrequest/3'
      const r = resolvePullRequestCi({
        env: {
          BUILD_REASON: 'PullRequest',
          SYSTEM_PULLREQUEST_PULLREQUESTID: '3',
          SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://dev.azure.com/acme/',
          SYSTEM_TEAMPROJECT: 'P',
          BUILD_REPOSITORY_NAME: 'r'
        },
        fs,
        provider: PROVIDER_AZURE_PIPELINES
      })

      la(r.pullRequestId === url, r)
      la(r.htmlUrl === url, r)
      la(r.pullRequestNumber === '3', r)
    })

    it('github-actions returns undefined when not a GHA run', () => {
      const r = resolvePullRequestCi({
        env: {},
        fs,
        provider: PROVIDER_GITHUB_ACTIONS
      })

      la(r === undefined, r)
    })
  })

  describe('adoGetPullRequestApiUrl', () => {
    it('builds REST URL when required env is set', () => {
      const u = adoGetPullRequestApiUrl({
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://fab.visualstudio.com/',
        SYSTEM_TEAMPROJECT: 'My Proj',
        BUILD_REPOSITORY_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '7'
      })
      la(
        u ===
          'https://fab.visualstudio.com/My%20Proj/_apis/git/repositories/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/pullRequests/7?api-version=7.0',
        u
      )
    })

    it('returns null when repository id is missing', () => {
      la(
        adoGetPullRequestApiUrl({
          SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://x/',
          SYSTEM_TEAMPROJECT: 'P',
          SYSTEM_PULLREQUEST_PULLREQUESTID: '1'
        }) == null
      )
    })
  })

  describe('enrichAzurePullRequestCi', () => {
    it('merges title and author from REST response', () => {
      const ci = {
        provider: PROVIDER_AZURE_PIPELINES,
        prTitle: 'from env',
        senderAvatarUrl: null,
        senderHtmlUrl: null
      }
      const env = {
        SYSTEM_ACCESSTOKEN: 't',
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://fab.visualstudio.com/',
        SYSTEM_TEAMPROJECT: 'P',
        BUILD_REPOSITORY_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '1'
      }
      const fetchJson = () =>
        Promise.resolve({
          title: 'UI title',
          createdBy: {
            imageUrl: 'https://img',
            url: 'https://profile'
          }
        })
      return enrichAzurePullRequestCi(ci, env, { fetchJson }).then(out => {
        la(out.prTitle === 'UI title', out)
        la(out.senderAvatarUrl === 'https://img', out)
        la(out.senderHtmlUrl === 'https://profile', out)
      })
    })

    it('returns same ci when token is missing', () => {
      const ci = { provider: PROVIDER_AZURE_PIPELINES, prTitle: 'x' }
      return enrichAzurePullRequestCi(ci, {}, {}).then(out => {
        la(out === ci, out)
      })
    })

    it('returns same ci when REST fails', () => {
      const ci = { provider: PROVIDER_AZURE_PIPELINES, prTitle: 'keep' }
      const env = {
        SYSTEM_ACCESSTOKEN: 't',
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://fab.visualstudio.com/',
        SYSTEM_TEAMPROJECT: 'P',
        BUILD_REPOSITORY_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '1'
      }
      const fetchJson = () => Promise.reject(new Error('401'))
      return enrichAzurePullRequestCi(ci, env, { fetchJson }).then(out => {
        la(out.prTitle === 'keep', out)
        la(out === ci, out)
      })
    })
  })

  describe('adoPrTitleFromEnv', () => {
    it('prefers SYSTEM_PULLREQUEST_TITLE', () => {
      la(
        adoPrTitleFromEnv({
          SYSTEM_PULLREQUEST_TITLE: 'Explicit',
          BUILD_SOURCEVERSIONMESSAGE: 'Merged PR 1: ignored'
        }) === 'Explicit'
      )
    })

    it('strips Merged PR prefix from BUILD_SOURCEVERSIONMESSAGE', () => {
      la(
        adoPrTitleFromEnv({
          BUILD_SOURCEVERSIONMESSAGE: 'Merged PR 42: my title'
        }) === 'my title'
      )
    })

    it('uses full first line when not a Merged PR message', () => {
      la(
        adoPrTitleFromEnv({ BUILD_SOURCEVERSIONMESSAGE: 'plain subject' }) ===
          'plain subject'
      )
    })

    it('returns null for Git default merge pull request subject', () => {
      la(
        adoPrTitleFromEnv({
          BUILD_SOURCEVERSIONMESSAGE:
            'Merge pull request 1 from feat/detect-azure-ci into master'
        }) == null
      )
    })
  })

  describe('readGithubActionsPullRequest', () => {
    it('injects fs for tests without stubbing global fs', () => {
      const fakeFs = {
        readFileSync: () => JSON.stringify(githubEvent)
      }
      const r = readGithubActionsPullRequest(
        '/x',
        'true',
        /** @type {any} */ (fakeFs)
      )

      la(r.provider === PROVIDER_GITHUB_ACTIONS, r)
    })
  })
})
