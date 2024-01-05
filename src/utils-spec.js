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
    headhSha: event.pull_request.head.sha,
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
})
