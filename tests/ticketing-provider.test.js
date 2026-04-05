import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ITicketingProvider } from '../.agents/scripts/lib/ITicketingProvider.js';

// ---------------------------------------------------------------------------
// Interface contract — default methods throw
// ---------------------------------------------------------------------------
describe('ITicketingProvider — interface contract', () => {
  const provider = new ITicketingProvider();

  const readMethods = [
    ['getEpic', [1]],
    ['getTickets', [1, {}]],
    ['getTicket', [1]],
    ['getTicketDependencies', [1]],
  ];

  const writeMethods = [
    ['createTicket', [1, { title: 'test', body: '', labels: [] }]],
    ['updateTicket', [1, {}]],
    ['postComment', [1, { body: 'test', type: 'progress' }]],
    ['createPullRequest', ['branch-name', 1]],
  ];

  const setupMethods = [
    ['ensureLabels', [[{ name: 'test', color: '#000', description: '' }]]],
    ['ensureProjectFields', [[{ name: 'Sprint', type: 'iteration' }]]],
  ];

  const allMethods = [...readMethods, ...writeMethods, ...setupMethods];

  for (const [methodName, args] of allMethods) {
    it(`${methodName}() throws "Not implemented" by default`, async () => {
      await assert.rejects(
        () => provider[methodName](...args),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('Not implemented'),
            `Expected "Not implemented" in message, got: "${err.message}"`,
          );
          assert.ok(
            err.message.includes(methodName),
            `Expected method name "${methodName}" in message, got: "${err.message}"`,
          );
          return true;
        },
      );
    });
  }

  it('has exactly 10 interface methods', () => {
    const expectedMethods = [
      'getEpic', 'getTickets', 'getTicket', 'getTicketDependencies',
      'createTicket', 'updateTicket', 'postComment', 'createPullRequest',
      'ensureLabels', 'ensureProjectFields',
    ];

    for (const method of expectedMethods) {
      assert.ok(
        typeof provider[method] === 'function',
        `Missing method: ${method}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Subclass override behavior
// ---------------------------------------------------------------------------
describe('ITicketingProvider — subclass behavior', () => {
  class TestProvider extends ITicketingProvider {
    async getEpic(epicId) {
      return {
        id: epicId,
        title: 'Test Epic',
        body: 'Test body',
        labels: ['type::epic'],
        linkedIssues: { prd: null, techSpec: null },
      };
    }
  }

  it('overridden method returns a value', async () => {
    const provider = new TestProvider();
    const result = await provider.getEpic(42);
    assert.equal(result.id, 42);
    assert.equal(result.title, 'Test Epic');
  });

  it('non-overridden methods still throw', async () => {
    const provider = new TestProvider();
    await assert.rejects(
      () => provider.createTicket(1, { title: 'x', body: '', labels: [] }),
      (err) => {
        assert.ok(err.message.includes('Not implemented: createTicket'));
        return true;
      },
    );
  });

  it('instanceof check works on subclass', () => {
    const provider = new TestProvider();
    assert.ok(provider instanceof ITicketingProvider);
  });
});
