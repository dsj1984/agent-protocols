import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gitSync } from './git-utils.js';
import { Logger } from './Logger.js';

export class GithubRefinementService {
  /**
   * @param {import('./ITicketingProvider.js').ITicketingProvider} provider
   * @param {string} cwd
   */
  constructor(provider, cwd = process.cwd()) {
    this.provider = provider;
    this.cwd = cwd;
  }

  /**
   * Create branch, commit changes, and open a PR.
   * @param {Object} pattern Friction pattern object
   * @param {string} explanation Explanation from LLM
   * @param {string} newContent Transformed content
   */
  async proposeRefinement(pattern, explanation, newContent) {
    Logger.info(
      `[GithubRefinementService] Proposing refinement for pattern ${pattern.patternId}...`,
    );

    if (!pattern.protocolFile) {
      throw new Error(
        '[GithubRefinementService] Cannot propose a refinement without a specific protocolFile.',
      );
    }

    const protocolFile = pattern.protocolFile;

    // Security Check: Ensure the file is within allowed directories
    const allowedDirs = [
      '.agents/personas/',
      '.agents/rules/',
      '.agents/skills/',
    ];
    const unixPath = protocolFile.replace(/\\/g, '/');
    const isAllowed = allowedDirs.some((dir) => unixPath.startsWith(dir));
    if (!isAllowed) {
      throw new Error(
        `[GithubRefinementService] Security violation: Cannot modify ${protocolFile}. Only files in ${allowedDirs.join(', ')} are allowed.`,
      );
    }

    const absPath = path.resolve(this.cwd, protocolFile);
    if (!fs.existsSync(absPath)) {
      throw new Error(`[GithubRefinementService] File not found: ${absPath}`);
    }

    // Hash the pattern category + file to create a unique branch
    const hash = crypto
      .createHash('md5')
      .update(`${pattern.category}:${protocolFile}`)
      .digest('hex')
      .substring(0, 8);
    const categorySlug = pattern.category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const branchName = `refinement/${categorySlug}/${hash}`;

    Logger.info(`[GithubRefinementService] Creating branch ${branchName}...`);

    // Backup current branch to restore it later if we are running locally instead of in CI
    let originalBranch = 'main';
    try {
      originalBranch = gitSync(this.cwd, 'branch', '--show-current').trim();
    } catch {
      // Ignore failure
    }

    try {
      gitSync(this.cwd, 'checkout', 'main');
      gitSync(this.cwd, 'pull', 'origin', 'main');

      try {
        gitSync(this.cwd, 'checkout', '-b', branchName);
      } catch {
        gitSync(this.cwd, 'checkout', branchName);
      }

      // Overwrite file
      fs.writeFileSync(absPath, newContent, 'utf8');

      // Commit
      gitSync(this.cwd, 'add', protocolFile);
      const diffStr = gitSync(this.cwd, 'diff', '--staged');

      if (!diffStr) {
        Logger.warn(
          `[GithubRefinementService] No changes detected for ${protocolFile}. Skipping PR.`,
        );
        gitSync(this.cwd, 'checkout', originalBranch || 'main');
        return null;
      }

      gitSync(
        this.cwd,
        'commit',
        '-m',
        `refactor(protocol): Autonomous refinement for ${pattern.category}`,
        '--no-verify',
      );

      Logger.info(`[GithubRefinementService] Pushing branch ${branchName}...`);
      gitSync(this.cwd, 'push', '-u', 'origin', branchName);

      // Create PR Body
      const evidenceList = pattern.events
        .map((e) => `- Task #${e.taskId}`)
        .join('\n');

      const prBody = `## Autonomous Protocol Refinement

**Friction Pattern Identified:** \`${pattern.category}\`

This change is proposed to address a recurring friction pattern where the agent encountered issues. The pattern was observed in ${pattern.eventCount} tasks across recent sprints.

### Evidence
${evidenceList}

### Explanation
${explanation}

### Proposed Change

\`\`\`diff
${diffStr}
\`\`\`
`;
      const prTitle = `Protocol Refinement: ${pattern.category} in ${path.basename(protocolFile)}`;
      const label = `refinement::${categorySlug}::${hash}`;

      Logger.info(`[GithubRefinementService] Creating pull request...`);

      // Attempt to hit the GitHub Provider's _rest directly since we know we are using it
      if (typeof this.provider._rest !== 'function') {
        throw new Error(
          '[GithubRefinementService] Internal provider._rest method is unavailable. Cannot create a generic PR.',
        );
      }

      const pr = await this.provider._rest(
        `/repos/${this.provider.owner}/${this.provider.repo}/pulls`,
        {
          method: 'POST',
          body: {
            title: prTitle,
            body: prBody,
            head: branchName,
            base: 'main',
          },
        },
      );

      Logger.info(`[GithubRefinementService] PR created! #${pr.number}`);

      // Apply label using provider updateTicket
      await this.provider.updateTicket(pr.number, {
        labels: { add: [label] },
      });
      Logger.info(
        `[GithubRefinementService] Label [${label}] applied to PR #${pr.number}`,
      );

      // Clean up local
      gitSync(this.cwd, 'checkout', originalBranch || 'main');

      return {
        number: pr.number,
        url: pr.html_url,
      };
    } catch (err) {
      Logger.error(`[GithubRefinementService] Failed: ${err.message}`);
      // Attempt to clean up
      try {
        gitSync(this.cwd, 'checkout', originalBranch || 'main');
      } catch {}
      throw err;
    }
  }
}
