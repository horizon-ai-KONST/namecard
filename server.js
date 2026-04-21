// Local dev server. Serves static files + API routes on one port.
import 'dotenv/config';
import { createApp } from './lib/app.js';

const app = createApp({ withStatic: true });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Tradeshow card app running on http://localhost:${PORT}`);
  console.log(`  Scanner: http://localhost:${PORT}/`);
  console.log(`  Display: http://localhost:${PORT}/display.html`);
  console.log(`  Health:  http://localhost:${PORT}/api/health\n`);
});
