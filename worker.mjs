/**
 * Wrangler entry: preserve the public hostname for Next middleware.
 * Without this, admin.arcx can look like the arcade host and serve the app.
 */
import openNextWorker from "./.open-next/worker.js";

export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "./.open-next/worker.js";

function withPublicHost(request) {
  const hostname = new URL(request.url).hostname;
  if (!hostname) return request;

  const headers = new Headers(request.headers);
  headers.set("host", hostname);
  headers.set("x-forwarded-host", hostname);

  return new Request(request, { headers });
}

export default {
  async fetch(request, env, ctx) {
    return openNextWorker.fetch(withPublicHost(request), env, ctx);
  },
};
