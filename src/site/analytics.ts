// Vercel Web Analytics for the static site. Loads /_vercel/insights/script.js (same origin, so the CSP allows it).
// That script only exists on Vercel, so skip it when the site runs locally.
import { inject } from '@vercel/analytics';

if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) inject();
