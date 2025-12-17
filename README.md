# GitHub action to clean up stale branches.

This action finds and deletes stale branches.

A stale branch is defined as a branch that:
- has its last commit older than `stale-days` (90 days by default)
- is not a default branch of the repository
- is not a protected branch
- is not in the `skip-branches` list (by default 'main,master,develop,development,staging,production,keep-alive-*')

By default, a stale branch also:
- has no unmerged commits (controlled by `skip-unmerged`)
- is not linked to an open PR (controlled by `skip-open-prs`)

## Usage

Create a workflow YAML file in your repository's `.github/workflows` directory. [Workflow examples](#workflow-examples) are available below. For more information, see the GitHub documentation on [creating a workflow file](https://help.github.com/en/articles/configuring-a-workflow#creating-a-workflow-file).

Inputs are defined in [`action.yml`](action.yml). None are required.

| Input parameter	| Description				| Default value	|
|-------------------|---------------------------|---------------|
| `github-token`	| Token used to access GitHub's API. 	| [`${{ github.token }}`] (https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context) |
| `stale-days`		| Number of days since last commit before a branch is considered stale	| 90 days		|
| `scan-once-per-day`	| Cache scanned branches for a day to avoid re-scanning during next workflow run	| true	|
| `skip-unmerged`	| Skip branches that have unmerged commits	| true	|
| `include-unmerged-and-closed-prs`	| This parameter modifies `skip-unmerged`. Include unmerged branches that have no open PRs but only closed unmerged PRs	| true	|
| `skip-open-prs`	| Skip branches with open pull requests		| true	|
| `skip-branches`	| Comma-separated list of branches excluded from processing (supports wildcards like release/*)	| 'main,master,develop,development,staging,production,keep-alive-*'	|
| `max-branches-to-delete`	| Max number of branches to delete in a single run	| 500	|
| `process-throttle-ms`	| Milliseconds to wait between processing each branch	| 0		|
| `rate-limit-threshold`	| The action will stop if the remaining GitHub API rate limit falls below this value	| 100	|
| `continue-on-errors`	| Continue processing other branches if an error occurs	| false		|
| `dry-run`			| Run in dry-run mode without deleting branches	| false	|

## Monitoring GitHub rate limits

If you have a large number of branches to process, you need to monitor GitHub REST API rate limits. To prevent potential issues - such as temporary or permanent API access bans - there are several related input parameters you can use:
- `rate-limit-threshold` - addresses primary rate limit. The action stops processing branches (hitting GitHub API) when the number of remaining requests in the current rate limit window falls below this value
- `max-branches-to-delete` - with an automatically generated token for a workflow run, there is a hard limit of 1,000 API requests per hour for standard repositories. Use this parameter to stay below that limit.
- `process-throttle-ms` - controls a delay after processing each branch. You can use this delay to slow down the branch processing rate if you are hitting secondary rate limits.
- `continue-on-errors` - can be used to help monitor errors related to secondary rate limits. It is recommended not to ignore errors caused by hitting secondary rate limits.

## Workflow examples

### Use defaults

This workflow deletes merged branches that are older than 90 days and not linked to open PRs. Exemptions: the default branch, protected branches, and the default skip-branches list 'main,master,develop,development,staging,production,keep-alive-*'. Scanned branches are stored in GitHub Cache and skipped branches are not rescanned for a day.

```yaml
# .github/workflows/stale-branches-cleanup.yml

name: Stale Branches Cleanup

on: workflow_dispatch

jobs:
  stale-branches-cleanup:
    runs-on: ubuntu-latest
    env:
      TZ: America/Chicago
    steps:
      - name: Set timezone
        run: |
          sudo timedatectl set-timezone $TZ
          date
      - name: Restore scanned branches cache
        uses: actions/cache/restore@v4
        with:
          path: scanned-branches.json
          key: scanned-branches-${{ github.run_id }}
          restore-keys: |
            scanned-branches-
      - name: Stale Branches Cleanup
        if: ${{ always() }}
        uses: enaumchuk/action-stale-branches-cleanup@v1
      - name: Save scanned branches cache
        if: ${{ always() }}
        uses: actions/cache/save@v4
        with:
          path: scanned-branches.json
          key: scanned-branches-${{ github.run_id }}
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
        uses: enaumchuk/action-stale-branches-cleanup@v1
        with:
          dry-run: true
```

### Scheduled cleanup
This workflow will run daily at once an hour at 1:00-3:00am. It will delete merged and unmerged stale branches.

```yaml
# .github/workflows/stale-branches-cleanup-scheduled.yml

name: Stale Branches Cleanup - Scheduled

on:
  schedule:
    - cron: '0 3 * * *'

jobs:
  stale-branches-cleanup:
    runs-on: ubuntu-latest
    env:
      TZ: America/Chicago
    steps:
      - name: Set timezone
        run: |
          sudo timedatectl set-timezone $TZ
          date
      - name: Restore scanned branches cache
        uses: actions/cache/restore@v4
        with:
          path: scanned-branches.json
          key: scanned-branches-${{ github.run_id }}
          restore-keys: |
            scanned-branches-
      - name: Stale Branches Cleanup
        uses: enaumchuk/action-stale-branches-cleanup@v1
        with:
          stale-days: 120
          scan-once-per-day: true
          skip-unmerged: false
      - name: Save scanned branches cache
        if: ${{ always() }}
        uses: actions/cache/save@v4
        with:
          path: scanned-branches.json
          key: scanned-branches-${{ github.run_id }}
```

### Note.
Distribution file is compiled using ncc.
```
ncc build src/index.js -o dist
```
