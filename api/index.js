// Vercel serverless entry. All /api/* requests land here.
// Static files (public/) are served directly by Vercel, so no express.static.
import { createApp } from '../lib/app.js';

const app = createApp({ withStatic: false });
export default app;
