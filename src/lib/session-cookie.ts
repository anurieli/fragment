/**
 * The session cookie's name only - not a secret, just a string both the
 * public app shell (src/app/page.tsx, to decide whether to skip the landing
 * page) and the private session module (hosted-only) need to agree on.
 */
export const SESSION_COOKIE = "fragment_session";
