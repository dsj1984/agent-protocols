/**
 * GithubHttpClient — low-level GitHub REST + GraphQL transport.
 *
 * Extracted from providers/github.js so the transport layer (token handling,
 * retry/backoff, pagination, URL construction) can be unit-tested in isolation
 * from the ticketing domain logic. The provider composes this client and
 * exposes the four proxy methods (_rest, _restPaginated, _graphql, token)
 * for backwards compatibility with existing call sites and tests.
 */

const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

export class GithubHttpClient {
  /**
   * @param {object} opts
   * @param {() => string} opts.tokenProvider  Lazy token resolver.
   * @param {typeof fetch} [opts.fetchImpl]    Injectable fetch for testing.
   */
  constructor({ tokenProvider, fetchImpl } = {}) {
    this._tokenProvider = tokenProvider;
    this._fetch = fetchImpl ?? ((...args) => fetch(...args));
    this._token = null;
  }

  get token() {
    if (!this._token) {
      this._token = this._tokenProvider();
    }
    return this._token;
  }

  /**
   * Fetch with exponential backoff retry for transient failures (H-3).
   * Retries on: 429 (rate limit), 5xx (server errors), network errors.
   */
  async _fetchWithRetry(url, fetchOpts, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this._fetch(url, fetchOpts);
        if (res.ok || res.status === 204 || attempt === maxRetries) return res;
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = parseInt(
            res.headers.get('retry-after') || '0',
            10,
          );
          const delay =
            retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
          console.warn(
            `[GitHubProvider] ${res.status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms...`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return res;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        const delay = 2 ** attempt * 1000;
        console.warn(
          `[GitHubProvider] Network error on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms: ${err.message}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error('[GitHubProvider] Retry loop exhausted without response');
  }

  async rest(endpoint, opts = {}) {
    const url = `${GITHUB_API}${endpoint}`;
    const method = opts.method ?? 'GET';

    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'node.js',
    };

    const fetchOpts = { method, headers };
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }

    const res = await this._fetchWithRetry(url, fetchOpts);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `[GitHubProvider] ${method} ${endpoint} failed (${res.status}): ${errorBody}`,
      );
    }

    if (res.status === 204) return null;
    return res.json();
  }

  async restPaginated(endpoint) {
    const allItems = [];
    const separator = endpoint.includes('?') ? '&' : '?';
    let page = 1;
    while (true) {
      const batch = await this.rest(
        `${endpoint}${separator}page=${page}&per_page=100`,
      );
      if (!Array.isArray(batch)) break;
      allItems.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    return allItems;
  }

  async graphql(query, variables = {}, opts = {}) {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'node.js',
      ...opts.headers,
    };

    const res = await this._fetchWithRetry(GITHUB_GRAPHQL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `[GitHubProvider] GraphQL request failed (${res.status}): ${errorBody}`,
      );
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(
        `[GitHubProvider] GraphQL errors: ${JSON.stringify(json.errors)}`,
      );
    }

    return json.data;
  }
}
