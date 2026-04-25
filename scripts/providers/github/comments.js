/**
 * GitHub Comments — comment CRUD over the issues API.
 */

const TYPE_BADGES = {
  progress: '🔄 **Progress**',
  friction: '⚠️ **Friction**',
  notification: '📢 **Notification**',
};

export async function getRecentComments(ctx, limit = 100) {
  const comments = await ctx.http.rest(
    `/repos/${ctx.owner}/${ctx.repo}/issues/comments?sort=created&direction=desc&per_page=${limit}`,
  );
  return comments || [];
}

export async function getTicketComments(ctx, ticketId) {
  const comments = await ctx.http.restPaginated(
    `/repos/${ctx.owner}/${ctx.repo}/issues/${ticketId}/comments`,
  );
  return comments || [];
}

export async function deleteComment(ctx, commentId) {
  await ctx.http.rest(
    `/repos/${ctx.owner}/${ctx.repo}/issues/comments/${commentId}`,
    { method: 'DELETE' },
  );
}

export async function postComment(ctx, ticketId, payload) {
  const badge = TYPE_BADGES[payload.type] ?? '';
  const body = badge ? `${badge}\n\n${payload.body}` : payload.body;

  const comment = await ctx.http.rest(
    `/repos/${ctx.owner}/${ctx.repo}/issues/${ticketId}/comments`,
    { method: 'POST', body: { body } },
  );

  return { commentId: comment.id };
}
