'use strict'

/* eslint-env mocha */
const assert = require('assert')
const {
  removeCredentials,
  removeCredentialsFromText
} = require('./remove-credentials')

describe('removeCredentials', () => {
  const urls = [
    [
      'GitLab job token',
      'https://gitlab-ci-token:glcbt-64_SECRET@gitlab.com/o/r.git',
      'https://gitlab.com/o/r.git'
    ],
    [
      'token as the user',
      'https://ghp_SECRET@github.com/o/r.git',
      'https://github.com/o/r.git'
    ],
    [
      'port',
      'https://x-access-token:SECRET@github.example.com:8443/o/r.git',
      'https://github.example.com:8443/o/r.git'
    ],
    [
      'Azure organization as the user',
      'https://org@dev.azure.com/org/p/_git/r',
      'https://dev.azure.com/org/p/_git/r'
    ],
    ['scp-style SSH', 'git@host:o/r.git', 'git@host:o/r.git'],
    [
      'SSH URL with a port',
      'ssh://git@host:2222/o/r.git',
      'ssh://host:2222/o/r.git'
    ],
    [
      'password with "@"',
      'https://user:p@ss@host/o/r.git',
      'https://host/o/r.git'
    ],
    [
      'encoded "@" in the password',
      'https://user:p%40ss@host/o/r.git',
      'https://host/o/r.git'
    ],
    ['no credentials', 'https://host/o/r.git', 'https://host/o/r.git'],
    ['not a URL', 'org/repo', 'org/repo']
  ]

  urls.forEach(([name, url, expected]) => {
    it(name, () => {
      assert.strictEqual(removeCredentials(url), expected)
    })
  })

  it('returns empty values as they are', () => {
    assert.strictEqual(removeCredentials(null), null)
    assert.strictEqual(removeCredentials(undefined), undefined)
    assert.strictEqual(removeCredentials(''), '')
  })
})

describe('removeCredentialsFromText', () => {
  it('removes credentials from each URL in a message', () => {
    assert.strictEqual(
      removeCredentialsFromText(
        "fatal: unable to access 'https://gitlab-ci-token:p@ss@gitlab.com/o/r.git/': 403" +
          ' and https://ghp_SECRET@github.com/o/r'
      ),
      "fatal: unable to access 'https://gitlab.com/o/r.git/': 403" +
        ' and https://github.com/o/r'
    )
  })
})
