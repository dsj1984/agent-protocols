/**
 * GitHub Labels — repo-level label setup.
 *
 * Per-ticket label mutations (`updateTicket({ labels: { add, remove } })`)
 * live in `issues.js` because they share the PATCH-or-POST decision with
 * the rest of the issue update path.
 */

export async function ensureLabels(ctx, labelDefs) {
  const existing = await ctx.http.restPaginated(
    `/repos/${ctx.owner}/${ctx.repo}/labels`,
  );
  const existingNames = new Set(existing.map((l) => l.name));

  const created = [];
  const skipped = [];

  for (const def of labelDefs) {
    if (existingNames.has(def.name)) {
      skipped.push(def.name);
      continue;
    }

    await ctx.http.rest(`/repos/${ctx.owner}/${ctx.repo}/labels`, {
      method: 'POST',
      body: {
        name: def.name,
        color: def.color.replace('#', ''),
        description: def.description || '',
      },
    });
    created.push(def.name);
  }

  return { created, skipped };
}
