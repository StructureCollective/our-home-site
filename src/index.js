// Our Home -- Worker entry point.
//
// Serves the static site as before via the ASSETS binding, and handles
// /api/* for the job application flow:
//   POST /api/apply                                   -- public, form submission
//   GET  /api/admin/me                                  -- admin, who's logged in
//   GET  /api/admin/applications                       -- admin, list
//   GET  /api/admin/applications/:id                   -- admin, detail
//   GET  /api/admin/applications/:id/pdf                -- admin, download PDF
//   POST /api/admin/applications/:id/send-phone-interview
//   POST /api/admin/applications/:id/send-zoom
//   POST /api/admin/regenerate-pdfs                     -- admin, re-render all stored PDFs
//
// /admin* and /api/admin* are protected at the edge by a Cloudflare Access
// application (see src/lib/access.js for the defense-in-depth check on our
// side too).

import { handleApply } from './routes/apply.js';
import {
  handleMe,
  handleList,
  handleDetail,
  handlePdf,
  handleSendPhoneInterview,
  handleSendZoom,
  handleRegeneratePdfs,
} from './routes/admin.js';

const ADMIN_DETAIL_RE = /^\/api\/admin\/applications\/(\d+)$/;
const ADMIN_PDF_RE = /^\/api\/admin\/applications\/(\d+)\/pdf$/;
const ADMIN_PHONE_RE = /^\/api\/admin\/applications\/(\d+)\/send-phone-interview$/;
const ADMIN_ZOOM_RE = /^\/api\/admin\/applications\/(\d+)\/send-zoom$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      try {
        return await routeApi(request, env, pathname);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal error', detail: String(err && err.message || err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Everything else: serve the static site exactly as before.
    return env.ASSETS.fetch(request);
  },
};

async function routeApi(request, env, pathname) {
  if (pathname === '/api/apply') {
    return handleApply(request, env);
  }

  if (pathname === '/api/admin/me' && request.method === 'GET') {
    return handleMe(request, env);
  }

  if (pathname === '/api/admin/applications' && request.method === 'GET') {
    return handleList(request, env);
  }

  if (pathname === '/api/admin/regenerate-pdfs' && request.method === 'POST') {
    return handleRegeneratePdfs(request, env);
  }

  let m;
  if ((m = pathname.match(ADMIN_PDF_RE)) && request.method === 'GET') {
    return handlePdf(request, env, Number(m[1]));
  }
  if ((m = pathname.match(ADMIN_PHONE_RE)) && request.method === 'POST') {
    return handleSendPhoneInterview(request, env, Number(m[1]));
  }
  if ((m = pathname.match(ADMIN_ZOOM_RE)) && request.method === 'POST') {
    return handleSendZoom(request, env, Number(m[1]));
  }
  if ((m = pathname.match(ADMIN_DETAIL_RE)) && request.method === 'GET') {
    return handleDetail(request, env, Number(m[1]));
  }

  return new Response('Not found', { status: 404 });
}
