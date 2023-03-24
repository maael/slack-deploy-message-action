import * as core from '@actions/core'
import fetch, {HeadersInit} from 'node-fetch'
import * as github from '@actions/github'

const iconMap: {[k: string]: string} = {
  staging: ':large_orange_circle:',
  production: ':large_green_circle:',
  nightly: ':night_with_stars:',
  uat: ':sleuth_or_spy:'
}

// eslint-disable-next-line no-shadow
enum WorkflowStatus {
  'success' = 'success',
  'cancelled' = 'cancelled',
  'failure' = 'failure',
  'started' = 'started'
}

const statusMap: Record<WorkflowStatus, {text: string; icon: string}> = {
  started: {
    text: 'deploying',
    icon: ':hourglass_flowing_sand:'
  },
  success: {
    text: 'deployed',
    icon: ':white_check_mark:'
  },
  cancelled: {
    text: 'cancelled',
    icon: ':grey_question:'
  },
  failure: {
    text: 'deployment failure',
    icon: ':x:'
  }
}

async function run(): Promise<void> {
  try {
    const commit = await getCommit()

    const octo = github.getOctokit(core.getInput('github_token'))

    const repoFull =
      core.getInput('repo') ||
      `${github.context.repo.owner}/${github.context.repo.repo}`
    const repoParts = repoFull.split('/')
    const owner = repoParts[0]
    const repo = repoParts[1]
    const environment = core.getInput('environment') || 'unknown environment'
    const status = (core.getInput('status') || 'started') as WorkflowStatus
    core.debug(`status: ${status}`)
    const statusDetails = statusMap[status] || statusMap.failure

    const [slackMap, commitData] = await Promise.all([
      getSlackMap(octo),
      getCommitData(octo, owner, repo, commit)
    ])
    core.debug(JSON.stringify(slackMap))

    let diffList: any[] = []
    if ([WorkflowStatus.started, WorkflowStatus.failure].includes(status)) {
      const statusCommit = await getServiceStatus()
      diffList = await getDiff(
        octo,
        owner,
        repo,
        slackMap,
        statusCommit,
        commit
      )
      core.info(
        `[${owner}/${repo}] diff ${statusCommit}...${commit}: ${diffList.length} commits`
      )
    }

    const actorLink = getNameLink(
      slackMap,
      commitData?.author?.login || github.context.actor
    )
    const commitLink = `<https://github.com/${owner}/${repo}/commit/${commit}|${commit.slice(
      0,
      7
    )}>`
    const repoLink = `<https://github.com/${owner}/${repo}|${owner}/${repo}>`
    const {protocol, host} = new URL(core.getInput('service_status_url'))
    const serviceLink = `${protocol}//${host}`
    const environmentIcon = iconMap[environment] || ':grey_question:'
    const envLink = `<${serviceLink}|${environment}>`

    const template =
      core.getInput('message_template') ||
      ':octocat: $ACTOR_LINK $STATUS_ICON $STATUS_TEXT $ENV_ICON $ENV_LINK\n$COMMIT_LINK in $REPO_LINK'

    const message = template
      .replace(
        '$ACTOR_LINK',
        environment === 'nightly' && status !== 'failure' ? '' : actorLink
      )
      .replace('$COMMIT_LINK', commitLink)
      .replace('$REPO_LINK', repoLink)
      .replace('$ENV_LINK', envLink)
      .replace('$ENV_ICON', environmentIcon)
      .replace('$STATUS_TEXT', statusDetails.text)
      .replace('$STATUS_ICON', statusDetails.icon)
      .replace(/\s\s/g, ' ')

    await sendToSlack(message, diffList, status)
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function getSlackMap(
  octokit: ReturnType<typeof github.getOctokit>
): Promise<{[k: string]: string}> {
  const slackMapRepo = core.getInput('slack_map_repo')
  const repoParts = slackMapRepo.split('/')
  const slackMapFile = core.getInput('slack_map_file') || 'mapping.json'
  core.debug(
    `Getting slack map from ${repoParts[0]}/${repoParts[1]} in ${slackMapFile}`
  )
  let result
  try {
    result = (await octokit.request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      {
        owner: repoParts[0],
        repo: repoParts[1],
        path: slackMapFile
      }
    )) as unknown as {data: {download_url: string}}
  } catch (e) {
    core.error(
      `Failed to get slack map ${repoParts[0]}/${
        repoParts[1]
      } in ${slackMapFile}: ${(e as Error).message}`
    )
    throw e
  }

  let downloaded = {}
  try {
    downloaded = await (await fetch(result.data.download_url)).json()
  } catch (e) {
    core.error(`Failed to download slack map: ${(e as Error).message}`)
  }

  return downloaded
}

async function getCommitData(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  commit: string
) {
  try {
    const result = await octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}',
      {owner, repo, ref: commit}
    )
    return result.data
  } catch (e) {
    core.warning(`Failed to get commit data: ${(e as Error).message}`)
    return undefined
  }
}

async function getDiff(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  slackMap: {[k: string]: string},
  base: string,
  head: string
): Promise<{image?: string; text: string}[]> {
  try {
    const result = await octokit.request(
      'GET /repos/{owner}/{repo}/compare/{base}...{head}',
      {
        owner,
        repo,
        base,
        head
      }
    )
    const diffMessage = result.data.commits
      .map(c => {
        return {
          text: formatMessage(slackMap, c),
          image: c.author?.avatar_url
        }
      })
      .reverse()
    return diffMessage
  } catch (e) {
    core.error(
      `Failed to get diff for ${owner}/${repo} ${base}...${head}: ${
        (e as Error).message
      }`
    )
    throw e
  }
}

function getNameLink(
  slackMap: {[k: string]: string},
  name: string,
  link?: string
) {
  const matchingSlack = slackMap[name]
  const nameLink = matchingSlack
    ? `<@${matchingSlack}>`
    : `<${link || `https://github.com/${name}`}|${name}>`
  return nameLink
}

function formatMessage(slackMap: {[k: string]: string}, c: any) {
  const author = getNameLink(slackMap, c.author?.login, c.author?.html_url)
  return `${author} <${c.html_url}|${c.commit.message.split('\n')[0] || '?'}>`
}

async function getServiceStatus(): Promise<string> {
  try {
    const serviceUrl = core.getInput('service_status_url')
    const serviceAuth = core.getInput('service_status_auth')
    const statusCommitField =
      core.getInput('status_commit_field') || 'BUILD_COMMIT'
    const serviceUrlParts = new URL(serviceUrl)
    serviceUrlParts.searchParams.append(
      'cb',
      `${Math.floor(Math.random() * 10000)}`
    )
    const headers: HeadersInit = {}
    if (serviceAuth) {
      headers['Authorization'] = serviceAuth
    }
    const status = await fetch(serviceUrlParts.toString(), {headers})
    const statusJson = await status.json()
    const statusCommit = statusJson[statusCommitField]
    return statusCommit
  } catch (e) {
    core.error(`Failed to get service status: ${(e as Error).message}`)
    throw e
  }
}

async function sendToSlack(
  message: string,
  commits: {text: string; image?: string}[],
  status: WorkflowStatus
) {
  if (core.getInput('dry_run')) {
    core.debug(`Skipping sending message: ${message}`)
    return
  }
  const channels = (core.getInput('channels') || '').split(',')
  const failureChannels =
    status === 'failure'
      ? (core.getInput('failure_channels') || '').split(',')
      : []
  const allChannels = [...new Set(channels.concat(failureChannels))]
  const icon_emoji =
    core.getInput('icon_emoji') || statusMap[status]?.icon || ':tada:'
  const username = core.getInput('username') || 'Workflow Deploy Message'
  await Promise.all(
    allChannels.map(async channel => {
      try {
        await fetch(core.getInput('slack_webhook'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel,
            username,
            icon_emoji,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: message
                }
              } as any
            ].concat(
              commits.map(c => ({
                type: 'context',
                elements: [
                  c.image
                    ? {type: 'image', image_url: c.image, alt_text: 'icon'}
                    : null,
                  {type: 'mrkdwn', text: c.text}
                ].filter(Boolean)
              }))
            )
          })
        })
      } catch (e) {
        core.error(
          `Failed to send to slack channel ${channel}: ${(e as Error).message}`
        )
        throw e
      }
    })
  )
}

async function getCommit(): Promise<string> {
  return core.getInput('commit') || github.context.sha
}

run()
