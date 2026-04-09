import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

// EXAMPLE: Strict Cloudflare environment bindings
type Bindings = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  MY_QUEUE: Queue;
};

const app = new Hono<{ Bindings: Bindings }>();

// EXAMPLE: Route with strict Zod validation and c.env access
app.post(
  '/api/example',
  zValidator(
    'json',
    z.object({
      title: z.string().min(1),
    }),
  ),
  async (c) => {
    const { title } = c.req.valid('json');
    const _db = c.env.DB; // Access via Cloudflare bindings, NOT process.env

    // Implementation here...

    return c.json({ success: true, title }, 201);
  },
);

export default app;
