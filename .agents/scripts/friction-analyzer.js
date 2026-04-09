#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { ProviderFactory } from './lib/provider-factory.js';
import { Logger } from './lib/Logger.js';
import { FrictionService } from './lib/friction-service.js';
import { RefinementAgent } from './lib/refinement-agent.js';
import { GithubRefinementService } from './lib/github-refinement-service.js';
import { resolveConfig } from './lib/config-resolver.js';

async function main() {
    Logger.info('[FrictionAnalyzer] Starting Protocol Refinement pipeline...');

    const args = process.argv.slice(2);
    let epicId = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--epic' && args[i+1]) {
            epicId = parseInt(args[i+1], 10);
            break;
        }
    }

    resolveConfig(); // Ensure config is loaded
    const provider = ProviderFactory.getProvider();

    if (!epicId) {
        Logger.info('[FrictionAnalyzer] No --epic provided. Attempting to find recent closed Epics...');
        const epics = await provider.getEpics();
        const closedEpics = epics.filter(e => e.state === 'closed').sort((a,b) => b.id - a.id);
        if (closedEpics.length > 0) {
            epicId = closedEpics[0].id;
            Logger.info(`[FrictionAnalyzer] Using most recently closed Epic #${epicId}.`);
        } else {
            Logger.error('[FrictionAnalyzer] Error: --epic <id> is required, and no closed Epics were found.');
            process.exit(1);
        }
    }

    const frictionService = new FrictionService(provider);
    const logs = await frictionService.ingestFrictionLogs(epicId);

    if (logs.length === 0) {
        Logger.info(`[FrictionAnalyzer] No friction logs found for Epic #${epicId}. Exiting.`);
        return;
    }

    const patterns = frictionService.classifyPatterns(logs);
    if (patterns.length === 0) {
        Logger.info(`[FrictionAnalyzer] No actionable patterns identified. Exiting.`);
        return;
    }

    // Process top 3 patterns to avoid flooding PRs
    const topPatterns = patterns.slice(0, 3);
    
    const refinementAgent = new RefinementAgent();
    const githubService = new GithubRefinementService(provider);

    for (const pattern of topPatterns) {
        if (!pattern.protocolFile) {
            Logger.warn(`[FrictionAnalyzer] Skipping pattern "${pattern.category}" because it lacks a specific protocolFile.`);
            continue;
        }

        Logger.info(`[FrictionAnalyzer] Processing pattern: ${pattern.category} in ${pattern.protocolFile} (${pattern.eventCount} events)`);

        try {
            const absPath = path.resolve(process.cwd(), pattern.protocolFile);
            if (!fs.existsSync(absPath)) {
                Logger.warn(`[FrictionAnalyzer] File ${pattern.protocolFile} not found.`);
                continue;
            }

            const currentContent = fs.readFileSync(absPath, 'utf8');
            Logger.info(`[FrictionAnalyzer] Requesting LLM suggestion...`);
            const suggestion = await refinementAgent.generateSuggestion(pattern, currentContent);
            
            if (!suggestion || !suggestion.newContent) {
                Logger.warn(`[FrictionAnalyzer] LLM did not return a valid suggestion.`);
                continue;
            }

            if (suggestion.newContent.trim() === currentContent.trim()) {
                Logger.info(`[FrictionAnalyzer] LLM returned identical content. No refinement needed.`);
                continue;
            }

            const pr = await githubService.proposeRefinement(pattern, suggestion.explanation, suggestion.newContent);
            if (pr) {
                Logger.info(`[FrictionAnalyzer] Successfully proposed refinement PR #${pr.number}: ${pr.url}`);
            }

        } catch (err) {
            Logger.error(`[FrictionAnalyzer] Error processing pattern ${pattern.category}: ${err.message}`);
        }
    }

    Logger.info('[FrictionAnalyzer] Pipeline completed successfully.');
}

main().catch(err => {
    Logger.error(`[FrictionAnalyzer] Fatal error: ${err.stack}`);
    process.exit(1);
});
