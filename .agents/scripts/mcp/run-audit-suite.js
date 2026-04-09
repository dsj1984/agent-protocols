import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Executes a list of audit workflows and aggregates their results.
 * @param {object} params
 * @param {string[]} params.auditWorkflows
 * @returns {Promise<object>} The aggregated AuditResults structure.
 */
export async function runAuditSuite({ auditWorkflows }) {
  // 1. Read audit-rules.json to get allowlist
  const rulesPath = path.join(process.cwd(), '.agents/schemas/audit-rules.json');
  let rulesData;
  try {
    rulesData = JSON.parse(await fs.readFile(rulesPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read audit-rules from ${rulesPath}: ${err.message}`);
  }

  const allowedAudits = Object.keys(rulesData.audits || {});

  // Validate inputs against allowlist
  for (const workflow of auditWorkflows) {
    if (!allowedAudits.includes(workflow)) {
      throw new Error(`Invalid audit workflow: ${workflow}. Must be one of: ${allowedAudits.join(', ')}`);
    }
  }

  const summary = {
    auditsRun: [],
    totalFindings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const results = [];

  // 2. Iterate and spawn child processes
  for (const workflow of auditWorkflows) {
    // Assuming audit scripts are placed in .agents/scripts/audits/
    const scriptPath = path.join(process.cwd(), '.agents', 'scripts', 'audits', `${workflow}.js`);

    try {
      await fs.access(scriptPath);
    } catch {
      // Script doesn't exist yet, mock or skip. We record it as an error finding to surface it safely.
      results.push({
        auditId: workflow,
        checkId: 'SYSTEM-MISSING-SCRIPT',
        fixId: 'system-fix',
        severity: 'Medium',
        message: `Audit script not found: ${scriptPath}`,
        location: {},
        recommendation: 'Implement the audit script as a node.js executable.'
      });
      continue;
    }

    summary.auditsRun.push(workflow);

    try {
      const { stdout } = await new Promise((resolve, reject) => {
        let out = '';
        let err = '';
        const proc = spawn('node', [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
        
        proc.stdout.on('data', (chunk) => { out += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { err += chunk.toString(); });
        
        proc.on('close', (code) => {
          if (code !== 0 && code !== 1) {
            return reject(new Error(`Exit code ${code}. Stderr: ${err}`));
          }
          resolve({ stdout: out });
        });
        proc.on('error', reject);
      });

      // 3. Parse machine readable JSON output from stdout
      let parsedOutput = [];
      try {
        // Assume script outputs a JSON array on stdout
        parsedOutput = stdout ? JSON.parse(stdout) : [];
        if (!Array.isArray(parsedOutput)) {
          // Wrap in array if it returned a single object
          parsedOutput = [parsedOutput];
        }
      } catch (parseErr) {
        throw new Error(`Failed to parse script output to JSON: ${parseErr.message}\nRaw Output: ${stdout.substring(0, 200)}`);
      }

      // 4. Normalize and append results
      for (const finding of parsedOutput) {
        results.push({
          auditId: workflow,
          checkId: finding.checkId || 'UNKNOWN_CHECK',
          fixId: finding.fixId || `${workflow}-fix-new`,
          severity: finding.severity || 'Medium',
          message: finding.message || 'Audit issue detected.',
          location: finding.location || {},
          recommendation: finding.recommendation || ''
        });

        // 5. Update summary statistics
        summary.totalFindings++;
        const sevPattern = (finding.severity || '').toLowerCase();
        if (sevPattern === 'critical') summary.critical++;
        else if (sevPattern === 'high') summary.high++;
        else if (sevPattern === 'medium') summary.medium++;
        else if (sevPattern === 'low') summary.low++;
        else summary.medium++;
      }

    } catch (execErr) {
      results.push({
        auditId: workflow,
        checkId: 'SYSTEM-EXEC-FAIL',
        fixId: 'system-fix',
        severity: 'High',
        message: `Execution failed for ${workflow}: ${execErr.message}`,
        location: {},
        recommendation: 'Check the audit script implementation and ensure it outputs valid JSON.'
      });
    }
  }

  return { summary, results };
}
