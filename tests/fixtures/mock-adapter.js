import { IExecutionAdapter } from '../../.agents/scripts/lib/IExecutionAdapter.js';

/**
 * Standardized Mock Execution Adapter for testing.
 */
export class MockAdapter extends IExecutionAdapter {
  constructor() {
    super();
    this.dispatched = [];
    this.statusMap = new Map();
  }

  get executorId() {
    return 'mock-adapter';
  }

  async dispatchTask(params) {
    this.dispatched.push(params);
    const dispatchId = `mock-${params.taskId}-${Date.now()}`;
    this.statusMap.set(dispatchId, { status: 'dispatched' });
    return { dispatchId, status: 'dispatched' };
  }

  async getTaskStatus(dispatchId) {
    return (
      this.statusMap.get(dispatchId) || {
        status: 'failed',
        message: 'Not found',
      }
    );
  }

  async cancelTask(dispatchId) {
    this.statusMap.set(dispatchId, { status: 'failed', message: 'Cancelled' });
  }

  describe() {
    return 'Mock Adapter for testing';
  }
}
