'use strict'

const { URL } = require('url')

/**
 * Removes the user name and password from a URL, as in
 * `https://gitlab-ci-token:<token>@gitlab.com/o/r.git`. Keeps the port.
 * Returns other values, such as `git@github.com:o/r.git`, as they are.
 *
 * Matches `removeAuthFromGitUrl` in the Currents server.
 *
 * @param {string|null|undefined} url
 * @returns {string|null|undefined}
 */
function removeCredentials (url) {
  if (typeof url !== 'string' || !url) {
    return url
  }
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
      return parsed.toString()
    }
    return url
  } catch (e) {
    return url
  }
}

/**
 * Removes the user name and password from every URL in a text, such as a git
 * error message that names the remote.
 */
function removeCredentialsFromText (text) {
  if (typeof text !== 'string') {
    return text
  }
  // the user info ends at the last "@" before the host, so a password can
  // contain "@"
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1')
}

module.exports = { removeCredentials, removeCredentialsFromText }
