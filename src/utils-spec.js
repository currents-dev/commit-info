'use strict'

const la = require('lazy-ass')
const is = require('check-more-types')
const { mergeWith, or } = require('ramda')
const sinon = require('sinon')
const fs = require('fs')

/* eslint-env mocha */
describe('utils', () => {
  const event = {
    pull_request: {
      head: {
        ref: 'test-ref',
        sha: 'test-sha'
      },
      base: {
        ref: 'test-ref',
        sha: 'test-sha'
      },
      issue_url: 'test-issue',
      html_url: 'test-html',
      title: 'test-title'
    },
    sender: {
      avatar_url: 'test-avatar',
      html_url: 'test-html'
    }
  }

  const eventResult = {
    headRef: event.pull_request.head.ref,
    headSha: event.pull_request.head.sha,
    baseRef: event.pull_request.base.ref,
    baseSha: event.pull_request.base.sha,
    issueUrl: event.pull_request.issue_url,
    htmlUrl: event.pull_request.html_url,
    prTitle: event.pull_request.title,
    senderAvatarUrl: event.sender.avatar_url,
    senderHtmlUrl: event.sender.html_url
  }

  describe('getFields', () => {
    const { getFields } = require('./utils')

    it('returns list of fields', () => {
      const fields = getFields()
      la(is.strings(fields), fields)
    })
  })

  describe('Object.assign', () => {
    it('replaces empty strings with non-empty', () => {
      const o = Object.assign({}, { foo: '' }, { foo: 'foo' })
      la(o.foo === 'foo', o)
    })

    it('overwrites first string', () => {
      const o = Object.assign({}, { foo: 'foo' }, { foo: '' })
      la(o.foo === '', o)
    })
  })

  describe('R.mergeWith', () => {
    it('keeps non-empty string', () => {
      const o = mergeWith(or, { foo: 'foo' }, { foo: '' })
      la(o.foo === 'foo', o)
    })
  })

  describe('firstFoundValue', () => {
    const { firstFoundValue } = require('./utils')

    const env = {
      a: 1,
      b: 2,
      c: 3
    }

    it('finds first value', () => {
      const found = firstFoundValue(['a', 'b'], env)
      la(found === 1, found)
    })

    it('finds second value', () => {
      const found = firstFoundValue(['z', 'a', 'b'], env)
      la(found === 1, found)
    })

    it('finds nothing', () => {
      const found = firstFoundValue(['z', 'x'], env)
      la(found === null, found)
    })
  })

  describe('getGhaEventData', () => {
    let readFileStub
    const { getGhaEventData } = require('./utils')

    beforeEach(() => {
      readFileStub = sinon
        .stub(fs, 'readFileSync')
        .returns(JSON.stringify(event))
    })

    afterEach(() => {
      readFileStub.restore()
    })

    it('returns event data if file path and gha env are truthy', () => {
      const eventData = getGhaEventData('test-path', 'true')

      la(JSON.stringify(eventData) === JSON.stringify(eventResult), eventData)
    })

    it('returns empty event data if file path is falsy', () => {
      const eventData = getGhaEventData(undefined, 'true')

      la(eventData === undefined, eventData)
    })

    it('returns empty event data if gha env variable is falsy', () => {
      const eventData = getGhaEventData('test-path', undefined)

      la(eventData === undefined, eventData)
    })
  })

  describe('getAdoPrEventData', () => {
    const { getAdoPrEventData } = require('./utils')

    it('returns undefined when build is not a pull request', () => {
      const eventData = getAdoPrEventData({
        BUILD_REASON: 'IndividualCI'
      })

      la(eventData === undefined, eventData)
    })

    it('returns undefined when pull request id is missing', () => {
      const eventData = getAdoPrEventData({
        BUILD_REASON: 'PullRequest'
      })

      la(eventData === undefined, eventData)
    })

    it('returns PR metadata from Azure Pipelines env vars', () => {
      const eventData = getAdoPrEventData({
        BUILD_REASON: 'PullRequest',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '123',
        SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/feature-name',
        SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main',
        BUILD_SOURCEBRANCH: 'refs/pull/123/merge',
        SYSTEM_PULLREQUEST_SOURCECOMMITID: 'deadbeef',
        SYSTEM_PULLREQUEST_TARGETCOMMITID: 'cafebabe', // undocumented — ignored
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://dev.azure.com/org/',
        SYSTEM_TEAMPROJECT: 'My Project',
        BUILD_REPOSITORY_NAME: 'my-repo',
        SYSTEM_PULLREQUEST_TITLE: 'Fix the thing',
        BUILD_REQUESTEDFORID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      })

      la(eventData.pullRequestNumber === '123', eventData)
      la(
        eventData.pullRequestId ===
          'https://dev.azure.com/org/My%20Project/_git/my-repo/pullrequest/123',
        eventData
      )
      la(eventData.pullRequestId === eventData.htmlUrl, eventData)
      la(eventData.buildSourceBranch === 'refs/pull/123/merge', eventData)
      la(eventData.headRef === 'refs/heads/feature-name', eventData)
      la(eventData.baseRef === 'refs/heads/main', eventData)
      la(eventData.headSha === 'deadbeef', eventData)
      la(eventData.baseSha === null, eventData)
      la(eventData.prTitle === 'Fix the thing', eventData)
      la(
        eventData.htmlUrl ===
          'https://dev.azure.com/org/My%20Project/_git/my-repo/pullrequest/123',
        eventData
      )
      la(eventData.issueUrl === null, eventData)
      la(
        eventData.senderHtmlUrl ===
          'https://dev.azure.com/org/_usersSettings/about?userId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        eventData
      )
      la(
        eventData.senderAvatarUrl ===
          'https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?size=2&api-version=5.1-preview.1',
        eventData
      )
    })

    it('derives prTitle from merge commit message when title env is unset', () => {
      const eventData = getAdoPrEventData({
        BUILD_REASON: 'PullRequest',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '1',
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://dev.azure.com/org/',
        SYSTEM_TEAMPROJECT: 'P',
        BUILD_REPOSITORY_NAME: 'r',
        BUILD_SOURCEVERSIONMESSAGE: 'Merged PR 1: feat: hello from ado'
      })

      la(eventData.prTitle === 'feat: hello from ado', eventData)
    })

    it('prTitle null when only Git merge-pull-request subject is available', () => {
      const eventData = getAdoPrEventData({
        BUILD_REASON: 'PullRequest',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '1',
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://dev.azure.com/org/',
        SYSTEM_TEAMPROJECT: 'P',
        BUILD_REPOSITORY_NAME: 'r',
        BUILD_SOURCEVERSIONMESSAGE:
          'Merge pull request 1 from feat/x into master'
      })

      la(eventData.prTitle == null, eventData)
    })

    it('leaves headSha null when SOURCECOMMITID absent (not BUILD_SOURCEVERSION)', () => {
      const eventData = getAdoPrEventData({
        BUILD_REASON: 'PullRequest',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '1',
        BUILD_SOURCEVERSION: 'abc123'
      })

      la(eventData.headSha == null, eventData)
      la(eventData.pullRequestNumber === '1', eventData)
      la(eventData.pullRequestId == null, eventData)
      la(eventData.htmlUrl == null, eventData)
    })
  })
})
