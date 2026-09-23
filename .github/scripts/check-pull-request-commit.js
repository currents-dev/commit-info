'use strict'

// Runs commitInfo on the checkout that actions/checkout makes for a
// pull_request event: GitHub's merge commit refs/pull/N/merge.
//
// EXPECTED_COMMIT=head: commitInfo reports the pull request's last commit
// EXPECTED_COMMIT=checkout: commitInfo reports the merge commit, as before

const assert = require('assert')
const { execFileSync } = require('child_process')
const { commitInfo } = require('../../src')

const headSha = process.env.HEAD_SHA
const expected = process.env.EXPECTED_COMMIT || 'head'

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8' }).replace(/\n$/, '')

const checkoutSha = git('rev-parse', 'HEAD')
assert.notStrictEqual(checkoutSha, headSha, 'expected the merge commit')

commitInfo()
  .then(info => {
    console.log(info)
    const sha = expected === 'head' ? headSha : checkoutSha
    assert.strictEqual(info.sha, sha)
    assert.strictEqual(info.message, git('show', '-s', '--pretty=%B', sha))
    assert.strictEqual(info.author, git('show', '-s', '--pretty=%an', sha))
    assert.strictEqual(info.email, git('show', '-s', '--pretty=%ae', sha))
    console.log(`commitInfo reported ${expected} commit ${sha}`)
  })
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
