// Our Home -- admin identity via Cloudflare Access.
//
// Cloudflare Access, when protecting a hostname/path, adds the
// `Cf-Access-Authenticated-User-Email` header to requests it forwards to the
// origin. We trust that header for /api/admin/* -- but only as long as this
// Worker cannot be reached any other way. By default every Worker also gets
// a *.workers.dev URL that is NOT covered by an Access application (Access
// only protects the hostnames/paths you explicitly configure). If that
// workers.dev route is left enabled, /api/admin/* would be reachable
// without going through Access at all, and this header could be spoofed by
// anyone.
//
// Two things make this safe:
//   1. Disable the workers.dev route for this Worker (Cloudflare dashboard:
//      Worker -> Settings -> Domains & Routes -- remove/disable the
//      workers.dev route so ourhomenc.com is the only way in).
//   2. Belt-and-suspenders: we also check the header's value against an
//      explicit allowlist (the ADMIN_EMAILS var below), so even a
//      misconfiguration doesn't let an arbitrary authenticated Cloudflare
//      user in -- only the two family admin accounts.

const ACCESS_EMAIL_HEADER = 'Cf-Access-Authenticated-User-Email';

/** Returns the admin's email if the request is authenticated via Access AND
 *  that email is on the ADMIN_EMAILS allowlist; otherwise null. */
export function getAdminEmail(request, env) {
  const email = request.headers.get(ACCESS_EMAIL_HEADER);
  if (!email) return null;

  const allowlist = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) {
    // Nothing configured yet -- fail closed rather than trusting the header
    // unconditionally.
    return null;
  }

  return allowlist.includes(email.toLowerCase()) ? email : null;
}

export function requireAdmin(request, env) {
  const email = getAdminEmail(request, env);
  if (!email) {
    return { email: null, response: new Response('Forbidden', { status: 403 }) };
  }
  return { email, response: null };
}
