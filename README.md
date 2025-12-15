# Github action to cleanup stale branches.

This action finds and deletes stale branches.

A stale branch is defined as a branch that:
- has last commit older than `stale-days` (by default 90) days
- is not a default branch of the repository
- is not a protected branch
- is not in `skip-branches` list (by default 'main,master,develop,development,staging,production,keep-alive-*')

Additionally by default:
- has no unmerged commits (controlled by `skip-unmerged`)
- is not linked to an open PR (controlled by `skip-open-prs`)

## Usage

Create a workflow `.yml` file in your repository's `.github/workflows` directory. [Workflow examples](#workflow-examples) are available below. For more information, reference the GitHub Documentation for [Creating a workflow file](https://help.github.com/en/articles/configuring-a-workflow#creating-a-workflow-file).

Inputs are defined in [`action.yml`](action.yml). None are required.

| Input parameter	| Description				| Default value	|
|-------------------|---------------------------|---------------|
| `github-token`	| Token used to access GitHub's API. 	| [`${{ github.token }}`] (https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context) |
| `stale-days`		| Number of days since last commit before a branch is considered stale	| 90 days		|
| `skip-unmerged`	| Skip branches that have unmerged commits	| true	|
| `skip-open-prs`	| Skip branches with open pull requests		| true	|
| `skip-branches`	| Comma-separated list of branches excluded from processing (supports wildcards like release/*)	| 'main,master,develop,development,staging,production,keep-alive-*'	|
| `max-branches-to-delete`	| Max number of branches to delete in a single run	| 500	|
| `process-throttle-ms`	| Milliseconds to wait between processing each branch	| 0		|
| `rate-limit-threshold`	| The action will stop if the remaining GitHub API rate limit falls below this value	| 100	|
| `continue-on-errors`	| Continue processing other branches if an error occurs	| false		|
| `dry-run`			| Run in dry-run mode without deleting branches	| false	|

## Monitoring GitHub rate limits

In case you have a large number of branches to process you have to watch GitHub REST API rate limits. To prevent potential issues - like temporary or permanent API access ban - there are a few related input parameters to use:
- `rate-limit-threshold` - adresses primary rate limit. The action stops processing branches (hitting GitHub API) when number of requests remaining in the current rate limit window falls below that number
- `max-branches-to-delete` - with automatically generated token for a workflow run there is a hard limit 1000 API hits per hour for standard repos. Use this parameter to stay below that limit.
- `process-throttle-ms` - this parameter controls a delay after processing each branch. You can use this delay to slow down branch processing rate if you're hitting a secondary rate limits.
- `continue-on-errors` - this parameter could be used to help with monitoring secondary rate limits related errors. It is suggested to NOT ignore errors caused by hitting a secondary rate limits

## Workflow examples

### Use defaults

This workflow deletes merged branches older than 90 days and not linked to open PRs. Exemptions: default branch, protected branches and default skip-branches list 'main,master,develop,development,staging,production,keep-alive-*'.

```yaml
# .github/workflows/stale-branches-cleanup.yml

name: Stale Branches Cleanup

on: workflow_dispatch

jobs:
  stale-branches-cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Stale Branches Cleanup
        uses: enaumchuk/stale-branches-cleanup@main
```

### Dry run

```yaml
# .github/workflows/stale-branches-cleanup-dryrun.yml

name: Stale Branches Cleanup - Dry Run

on: workflow_dispatch

jobs:
  stale-branches-cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Stale Branches Cleanup
        uses: enaumchuk/stale-branches-cleanup@main
		with:
			dry-run: true
```

### Scheduled cleanup
This workflow will run daily at 3:00am. It will delete merged and unmerged stale branches.

```yaml
# .github/workflows/stale-branches-cleanup-scheduled.yml

name: Stale Branches Cleanup - Scheduled

on:
  schedule:
    - cron: '0 3 * * *'

jobs:
  stale-branches-cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Stale Branches Cleanup
        uses: enaumchuk/stale-branches-cleanup@main
		with:
			skip-unmerged: false
```
