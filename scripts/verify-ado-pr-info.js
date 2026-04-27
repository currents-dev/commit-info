'use strict'

/**
 * Run in Azure Pipelines on PR builds to ensure commit-info reads
 * SYSTEM_PULLREQUEST_* variables into adoEventData.
 *
 * Non-PR runs (push to main, manual) skip with a log line.
 */

const la = require('lazy-ass')
const { commitInfo } = require('../src')

const reason = process.env.BUILD_REASON || ''

if (reason !== 'PullRequest') {
  console.log(
    'ado-pr-verify: skip (BUILD_REASON=%s; only PullRequest runs assertions)',
    reason || '(empty)'
  )
  process.exit(0)
}

commitInfo(process.cwd(), { pullRequestProvider: 'azure-pipelines' })
  .then(info => {
    const ado = info.adoEventData
    console.log('ado-pr-verify: adoEventData =', JSON.stringify(ado, null, 2))
    la(
      ado,
      'expected adoEventData on Azure PR build; is SYSTEM_PULLREQUEST_PULLREQUESTID set?'
    )
    la(
      ado.pullRequestId,
      'expected pullRequestId from SYSTEM_PULLREQUEST_PULLREQUESTID'
    )
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
