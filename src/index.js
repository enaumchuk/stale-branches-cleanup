import * as core from "@actions/core";
import * as github from "@actions/github";

async function isSafeToProceedWithApiCalls(octokit, threshold = 100) {
	// Use the built-in octokit client from @actions/github
	try {
		// This call itself does not count against your rate limit.
		const { data } = await octokit.rest.rateLimit.get();

		const coreLimit = data.resources.core;

		if (coreLimit.remaining < threshold) {
		core.warning(`API rate limit is running low! Only ${coreLimit.remaining} calls remaining.`);
		return false;
		}
		return true;
	} catch (error) {
		core.warning(`Failed to check API rate limit: ${error.message}`);
		// If we can't determine the rate limit, assume it's safe to proceed
		return true;
	}
  }

// Define ANSI color codes (for foreground colors)
const ANSI_COLOR_RED    = '\x1b[31m';
const ANSI_COLOR_GREEN  = '\x1b[32m';
const ANSI_COLOR_YELLOW = '\x1b[93m';
const ANSI_COLOR_BLUE   = '\x1b[34m';
const ANSI_COLOR_RESET  = '\x1b[0m'; // CRITICAL: Resets color back to default

// Declare outputs
const outputDeletedBranches = [];
let deletedCount = 0;

try {
	// Get inputs
	const token = core.getInput('github-token');

	const staleDays = parseInt(core.getInput('stale-days'), 10);

	const skipBranches = core.getInput('skip-branches');
	const skipUmerged = !(core.getInput('skip-unmerged') === 'false');
	const skipOpenPRs = !(core.getInput('skip-open-prs') === 'false');
	const includeClosedPRs = !(core.getInput('include-unmerged-and-closed-prs') === 'false');

	const maxBranchesToDelete = parseInt(core.getInput('max-branches-to-delete'), 10);
	const processThrottleMs = parseInt(core.getInput('process-throttle-ms'), 10);
	const rateLimitThreshold = parseInt(core.getInput('rate-limit-threshold'), 10);

	const continueOnErrors = core.getInput('continue-on-errors') === 'true';

	const dryRun = core.getInput('dry-run') === 'true';

	// Validate inputs
	if (isNaN(staleDays) || staleDays < 0) {
		throw new Error('Invalid input: stale-days must be a non-negative integer');
	}
	if (isNaN(maxBranchesToDelete) || maxBranchesToDelete <= 0) {
		throw new Error('Invalid input: max-branches-to-delete must be a positive integer');
	}
	if (isNaN(processThrottleMs) || processThrottleMs < 0) {
		throw new Error('Invalid input: process-throttle-ms must be a non-negative integer');
	}
	if (isNaN(rateLimitThreshold) || rateLimitThreshold < 0) {
		throw new Error('Invalid input: rate-limit-threshold must be a non-negative integer');
	}

	// Calculate stale threshold date
	const now = new Date();
	const staleThreshold = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);

	// Parse branch exclusions
	core.info(`Original skip-branches value: '${skipBranches}'`);
	const skipBranchNames = [];
	const skipBranchPatterns = [];
	const skipBranchPatternsRegex = [];

	// Split the input string by commas and trim whitespace from each part
	const exclusions = skipBranches.split(',').map(item => item.trim()).filter(item => item.length > 0);

	for (const item of exclusions) {
	  // Check if the item contains a wildcard character '*'
	  if (item.includes('*')) {
		// It's a pattern/glob

		// Convert the glob pattern into a JavaScript-compatible RegExp object.
		// 1. Replace the '*' wildcard with '.*' (match any character zero or more times).
		const regexPattern = new RegExp('^' + item.replace(/\*/g, '.*') + '$');
		skipBranchPatternsRegex.push(regexPattern);
		skipBranchPatterns.push(regexPattern.source);

	  } else {
		// It's a literal branch name
		skipBranchNames.push(item);
	  }
	}
	core.info(`Excluded branch names:`);
	core.info(JSON.stringify(skipBranchNames, null, 2));
	core.info(`Excluded branch patterns:`);
	core.info(JSON.stringify(skipBranchPatterns, null, 2));
	core.info('');

	// Get context
	const context = github.context;
	const octokit = github.getOctokit(token);

	core.info(`Stale banch clean-up started`);
	core.info(`Repository: ${context.repo.owner}/${context.repo.repo}`);
	core.info(`Event: ${context.eventName}`);

	// Analyze repo info
	const { data: repo } = await octokit.rest.repos.get({
		owner: context.repo.owner,
		repo: context.repo.repo
	});
	const defaultBranch = repo.default_branch;
	core.info(`Repository info:`);
	core.info(`\t- Default branch: ${repo.default_branch}`);
	core.info(`\t- Private: ${repo.private}`);
	core.info(`\t- Fork: ${repo.fork}`);
	core.info('');


	// Handle workflow_dispatch or schedule events (stale branch cleanup)
	if (context.eventName === 'workflow_dispatch' || context.eventName === 'schedule') {
		core.info(`Pulling branches...`);

		// Get all branches
		const branches = await octokit.paginate(
			octokit.rest.repos.listBranches,
			{
				owner: context.repo.owner,
				repo: context.repo.repo,
				per_page: 100
			});

		core.info(`Found ${branches.length} branches`);
		core.info('');

		let processedCount = 0;

		for (const branch of branches) {
			// Check API rate limit
			const canProceed = await isSafeToProceedWithApiCalls(octokit, rateLimitThreshold);
			if (!canProceed) {
				core.warning(`API rate limit below threshold of ${rateLimitThreshold}. Stopping further processing...`);
				throw new Error('API rate limit exceeded threshold');
			}

			// Stop if max deletions reached
			if (processedCount >= maxBranchesToDelete) {
				core.warning(`Reached maximum branch deletion limit of ${maxBranchesToDelete}. Stopping further processing...`);
				break;
			}

			core.info(`${branch.name}`);

			// check if it's default branch
			if (branch.name === defaultBranch) {
				core.info(`\t${ANSI_COLOR_YELLOW}Skipping${ANSI_COLOR_RESET} - default branch`);
				continue;
			}

			// check if the branch is protected
			if (branch.protected) {
				core.info(`\t${ANSI_COLOR_YELLOW}Skipping${ANSI_COLOR_RESET} - protected branch`);
				continue;
			}

			// check if the branch excluded
			let isExcluded = false;
			// Check names
			if (skipBranchNames.includes(branch.name)) {
				isExcluded = true;
			} else {
				// Check patterns
				for (const pattern of skipBranchPatternsRegex) {
					if (pattern.test(branch.name)) {
						isExcluded = true;
						break; // Stop checking patterns once a match is found
					}
				}
			}
			if (isExcluded) {
				core.info(`\t${ANSI_COLOR_YELLOW}Skipping${ANSI_COLOR_RESET} - excluded branch`);
				continue;
			}

			// Get the last commit date
			try {
				const { data: commit } = await octokit.rest.repos.getCommit({
					owner: context.repo.owner,
					repo: context.repo.repo,
					ref: branch.commit.sha
				});

				const commitDate = new Date(commit.commit.committer.date);
				const daysSinceCommit = Math.floor((now - commitDate) / (1000 * 60 * 60 * 24));

				// Check if the branch is stale
				if (commitDate < staleThreshold) {

					core.info(`\t${ANSI_COLOR_RED}Stale branch${ANSI_COLOR_RESET} - the last commit was ${daysSinceCommit} days ago`);

					// Check for open pull requests
					if (skipOpenPRs) {
						const { data: pullRequests } = await octokit.rest.pulls.list({
							owner: context.repo.owner,
							repo: context.repo.repo,
							state: 'open',
							head: `${context.repo.owner}:${branch.name}`
						});
						if (pullRequests.length > 0) {
							core.info(`\t${ANSI_COLOR_YELLOW}Skipping${ANSI_COLOR_RESET} - the branch has ${pullRequests.length} open pull request(s)`);
							continue;
						}
					}

					// Check for unmerged commits
					if (skipUmerged) {
						const { data: compare } = await octokit.rest.repos.compareCommits({
							owner: context.repo.owner,
							repo: context.repo.repo,
							base: defaultBranch,
							head: branch.name
						});
						if (compare.ahead_by > 0) {
							if (includeClosedPRs) {
								// Check if there are closed PRs for this branch
								const prs = await octokit.paginate(
									octokit.rest.pulls.list,
									{
										owner: context.repo.owner,
										repo: context.repo.repo,
										state: 'all',
										head: `${context.repo.owner}:${branch.name}`,
										per_page: 100
									}
								  );
								const hasOpenPRs = prs.some(pr => pr.state === 'open');
								const hasClosedUnmergedPRs = prs.some(pr => pr.state === 'closed' && !pr.merged_at);
								if (hasOpenPRs) {
									core.info(`\t${ANSI_COLOR_YELLOW}Skipping${ANSI_COLOR_RESET} - the branch has unmerged commits (${compare.ahead_by} commits ahead of ${defaultBranch}) and open PRs`);
									continue;
								} else if (hasClosedUnmergedPRs) {
									core.info(`\t${ANSI_COLOR_RED}Including${ANSI_COLOR_RESET} - the branch has unmerged commits (${compare.ahead_by} commits ahead of ${defaultBranch}) but only closed unmerged PRs`);
								} else {
									core.info(`\t${ANSI_COLOR_YELLOW}Skipping${ANSI_COLOR_RESET} - the branch has unmerged commits (${compare.ahead_by} commits ahead of ${defaultBranch})`);
									continue;
								}
							} else {
								// If not including closed PRs, skip the branch
								core.info(`\t${ANSI_COLOR_YELLOW}Skipping${ANSI_COLOR_RESET} - the branch has unmerged commits (${compare.ahead_by} commits ahead of ${defaultBranch})`);
								continue;
							}
						}
					}



					if (dryRun) {
						core.info(`\t${ANSI_COLOR_BLUE}Dry Run${ANSI_COLOR_RESET} - would delete this branch when dry-run==false`);
					} else {
						await octokit.rest.git.deleteRef({
							owner: context.repo.owner,
							repo: context.repo.repo,
							ref: `heads/${branch.name}`
						});
						core.info(`\t${ANSI_COLOR_RED}Deleted${ANSI_COLOR_RESET} stale branch`);
						outputDeletedBranches.push(branch.name);
						deletedCount++;
					}
					processedCount++;
				} else {
					core.info(`\t${ANSI_COLOR_GREEN}Active branch${ANSI_COLOR_RESET} - the last commit was ${daysSinceCommit} days ago`);
				}
			} catch (error) {
				if (continueOnErrors) {
					core.warning(`\t${ANSI_COLOR_RED}Error processing this branch, but continuing due to configuration${ANSI_COLOR_RESET}: ${error.message}`);
					continue;
				} else {
					core.warning(`\t${ANSI_COLOR_RED}Error processing this branch, stopping further processing${ANSI_COLOR_RESET}`);
					throw error;
				}
			}

			// Throttle processing if needed
			if (processThrottleMs > 0) {
				core.info(`\tWaiting for ${processThrottleMs} ms before processing next branch...`);
				await new Promise(resolve => setTimeout(resolve, processThrottleMs));
			}
		}
		core.info(`Stale branch cleanup complete.`);
	} else {
		core.info(`Event '${context.eventName}' is not supported for stale branch cleanup. Exiting.`);
	}
	// Set outputs
	core.setOutput('deleted-branches', outputDeletedBranches);
	core.info(`Deleted ${deletedCount} branches.`);
} catch (error) {
	if (!isNaN(deletedCount)) {
		core.setOutput('deleted-branches', outputDeletedBranches);
		core.info(`Deleted ${deletedCount} branches.`);
	}
	core.setFailed(`Action failed: ${error.message}`);
}
