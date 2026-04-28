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
  adoPrTitleFromEnv
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
