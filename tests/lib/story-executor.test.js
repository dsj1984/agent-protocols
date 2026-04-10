import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executeStory } from '../../.agents/scripts/lib/orchestration/story-executor.js';
import { MockProvider } from '../fixtures/mock-provider.js';

describe('executeStory', () => {
  it('generates a story execution manifest with sorted tasks', async () => {
    const provider = new MockProvider({
      tickets: {
        100: {
          id: 100,
          title: 'Story 100',
          state: 'open',
          labels: ['type::story'],
          body: 'Epic: #50\nparent: #50',
        },
        101: {
          id: 101,
          title: 'Task A',
          state: 'open',
          labels: ['type::task', 'agent::ready'],
          body: 'parent: #100',
        },
        102: {
          id: 102,
          title: 'Task B',
          state: 'open',
          labels: ['type::task', 'agent::ready'],
          body: 'parent: #100\nBlocked by: #101',
        },
      },
    });
    // getTickets with epicId returns tasks with type::task
    provider.getTickets = async (_epicId, _opts) => {
      return Object.values(provider.tickets).filter((t) =>
        t.labels.includes('type::task'),
      );
    };

    const story = provider.tickets[100];
    const manifest = await executeStory({ story, provider });

    assert.strictEqual(manifest.type, 'story-execution');
    assert.strictEqual(manifest.stories.length, 1);
    assert.strictEqual(manifest.stories[0].storyId, 100);
    assert.strictEqual(manifest.stories[0].epicId, 50);
    assert.ok(manifest.stories[0].branchName.includes('story'));
    assert.strictEqual(manifest.stories[0].tasks.length, 2);
  });

  it('handles story with no parent Epic', async () => {
    const provider = new MockProvider({
      tickets: {
        200: {
          id: 200,
          title: 'Standalone Story',
          state: 'open',
          labels: ['type::story'],
          body: 'No epic reference here',
        },
      },
    });
    provider.getTickets = async () => [];

    const story = provider.tickets[200];
    const manifest = await executeStory({ story, provider });

    assert.strictEqual(manifest.stories[0].epicId, null);
    assert.strictEqual(manifest.stories[0].branchName, 'story-200');
    assert.strictEqual(manifest.stories[0].tasks.length, 0);
  });

  it('falls back gracefully on cyclic task dependencies', async () => {
    const provider = new MockProvider({
      tickets: {
        300: {
          id: 300,
          title: 'Story 300',
          state: 'open',
          labels: ['type::story'],
          body: 'Epic: #50',
        },
        301: {
          id: 301,
          title: 'Cyclic Task A',
          state: 'open',
          labels: ['type::task', 'agent::ready'],
          body: 'parent: #300\nBlocked by: #302',
        },
        302: {
          id: 302,
          title: 'Cyclic Task B',
          state: 'open',
          labels: ['type::task', 'agent::ready'],
          body: 'parent: #300\nBlocked by: #301',
        },
      },
    });
    provider.getTickets = async () => [
      provider.tickets[301],
      provider.tickets[302],
    ];

    const story = provider.tickets[300];
    const manifest = await executeStory({ story, provider });

    // Should still produce a manifest, falling back to raw list
    assert.strictEqual(manifest.stories[0].tasks.length, 2);
  });

  it('respects dryRun flag', async () => {
    const provider = new MockProvider({
      tickets: {
        400: {
          id: 400,
          title: 'DryRun Story',
          state: 'open',
          labels: ['type::story'],
          body: 'Epic: #10',
        },
      },
    });
    provider.getTickets = async () => [];

    const manifest = await executeStory({
      story: provider.tickets[400],
      provider,
      dryRun: true,
    });
    assert.strictEqual(manifest.dryRun, true);
  });
});
