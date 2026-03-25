# Cloudflare Queue Manager

**Description:** Enforces correct patterns for producing and consuming
Cloudflare Queues messages.

**Instruction:** You are implementing producer/consumer logic using Cloudflare
Queues. You MUST follow these architectural rules:

- ALWAYS define a `queue` binding in `wrangler.toml` for both the producer (as a
  queue binding) and the consumer (as a `[[queues.consumers]]` entry). Never
  assume a queue is configured; verify the binding exists.
- Producers MUST call `env.MY_QUEUE.send(message)` with a serializable JSON
  payload. NEVER send non-serializable objects (class instances, Promises,
  etc.).
- Include a `contentType` field in every message payload for schema versioning
  (e.g., `{ contentType: 'user.created.v1', data: { ... } }`).
- Consumer `queue` handlers MUST be idempotent. Assume any message can be
  delivered more than once and design accordingly.
- ALWAYS use `message.ack()` explicitly on success. Use `message.retry()` or
  `batch.retryAll()` on transient failures, and `message.ack()` with a
  dead-letter log on permanent failures.
- NEVER perform long-running synchronous work in the consumer that may exceed
  the Worker CPU time limit. Offload to Durable Objects or an external service
  if needed.
- Handle `batch.messages` as an array; process messages concurrently with
  `Promise.allSettled()` to avoid a single failure blocking the entire batch.
