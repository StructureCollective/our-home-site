// Our Home -- Worker entry point.
//
// This replaces the previous "static assets only" deployment. It currently
// behaves identically to the old static site (every request is served from
// the same files as before, via the ASSETS binding), but now that there's a
// real script here, the D1 (DB) and R2 (PDF_BUCKET) bindings declared in
// wrangler.jsonc are available for use -- and it gives us a place to add the
// application submission and admin endpoints next, under /api/*.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      // Placeholder -- application submission handling and admin endpoints
      // (listing applicants, sending interview emails, etc.) will be added
      // here next.
      return new Response('Not implemented yet', { status: 501 });
    }

    // Everything else: serve the static site exactly as before.
    return env.ASSETS.fetch(request);
  },
};
