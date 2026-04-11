import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import path from 'node:path';
import { Volume } from 'memfs';
import {
  resolveConfig,
  PROJECT_ROOT,
} from '../../.agents/scripts/lib/config-resolver.js';
import { setupFsMock } from './fs-mock.js';

describe('config-resolver library tests', () => {
  let vol;

  beforeEach((t) => {
    vol = new Volume();
    setupFsMock(t, vol);
    // Reset cached config for each test
    resolveConfig({ bustCache: true });
  });

  it('uses default config when .agentrc.json is missing', () => {
    const config = resolveConfig({ bustCache: true });
    assert.equal(config.source, 'built-in defaults');
    assert.equal(config.settings.agentRoot, '.agents');
    assert.equal(config.orchestration, null);
  });

  it('throws error when .agentrc.json is malformed JSON', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(agentrcPath, '{ invalid json }');

    assert.throws(
      () => resolveConfig({ bustCache: true }),
      /\[config\] Failed to parse .agentrc.json/
    );
  });

  it('throws error when agentSettings contain security violations', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(agentrcPath, JSON.stringify({
      agentSettings: {
        baseBranch: 'main; rm -rf /'
      }
    }));

    assert.throws(
      () => resolveConfig({ bustCache: true }),
      /\[Security\] Malicious configuration value detected in .agentrc.json/
    );
  });

  it('applies environment variable override for notificationWebhookUrl', () => {
    const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
    vol.mkdirSync(PROJECT_ROOT, { recursive: true });
    vol.writeFileSync(agentrcPath, JSON.stringify({
      agentSettings: {
        notificationWebhookUrl: 'https://original.com'
      },
      orchestration: {
        provider: 'github',
        github: { owner: 'org', repo: 'repo' },
        notifications: {
          webhookUrl: 'https://original.com'
        }
      }
    }));

    const originalEnv = process.env.NOTIFICATION_WEBHOOK_URL;
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://override.com';

    try {
      const config = resolveConfig({ bustCache: true });
      assert.equal(config.settings.notificationWebhookUrl, 'https://override.com');
      assert.equal(config.orchestration.notifications.webhookUrl, 'https://override.com');
    } finally {
      process.env.NOTIFICATION_WEBHOOK_URL = originalEnv;
    }
  });

  it('merges defaults with loaded config', () => {
     const agentrcPath = path.join(PROJECT_ROOT, '.agentrc.json');
     vol.mkdirSync(PROJECT_ROOT, { recursive: true });
     vol.writeFileSync(agentrcPath, JSON.stringify({
       agentSettings: {
         agentRoot: 'custom-agents'
       }
     }));

     const config = resolveConfig({ bustCache: true });
     assert.equal(config.settings.agentRoot, 'custom-agents');
     assert.equal(config.settings.scriptsRoot, '.agents/scripts'); // default
  });
});
