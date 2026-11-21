// Storefront + delivery + webhooks + scheduler. Zero framework, one file.
import http from 'node:http';
import fs from 'node:fs';
import { listBooks, getBook, pdfPath } from './lib/books.js';
import { getPaidSession, verifyWebhook } from './lib/stripe.js';
import { runAgent } from './agent/run.js';

const PORT = Number(process.env.PORT || 8080);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (c) => `$${(c / 100).toFixed(2)}`;

const page = (title, body, meta = '') => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${meta}
<style>
:root{color-scheme:light dark;--bg:#fbfbfd;--fg:#1d1d1f;--mute:#6e6e73;--card:#fff;--accent:#0071e3}
@media(prefers-color-scheme:dark){:root{--bg:#000;--fg:#f5f5f7;--mute:#a1a1a6;--card:#1c1c1e}}
*{box-sizing:border-box}body{margin:0;font:17px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased}
main{max-width:680px;margin:0 auto;padding:72px 24px}
h1{font-size:clamp(34px,6vw,52px);line-height:1.05;letter-spacing:-.02em;margin:0 0 12px}
.sub{color:var(--mute);font-size:21px;margin:0 0 32px}
ul{padding-left:20px}li{margin:6px 0}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:14px 28px;border-radius:980px;font-weight:600;margin-top:24px}
.card{display:block;background:var(--card);border-radius:18px;padding:24px;margin:16px 0;text-decoration:none;color:inherit;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.mute{color:var(--mute)}
</style></head><body><main>${body}</main></body></html>`;

function send(res, status, html, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(html);
}

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c)).on('end', () => resolve(data));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/health') return send(res, 200, 'ok', 'text/plain');

    if (url.pathname === '/') {
      const cards = listBooks()
        .map((b) => `<a class="card" href="/b/${b.slug}"><strong>${esc(b.title)}</strong><br><span class="mute">${esc(b.subtitle)}</span></a>`)
        .join('');
      return send(res, 200, page('Micro Books', `<h1>Micro Books</h1><p class="sub">Small books. Useful today.</p>${cards || '<p class="mute">No books yet. Run the agent.</p>'}`));
    }

    if (url.pathname.startsWith('/b/')) {
      const b = getBook(url.pathname.slice(3));
      if (!b) return send(res, 404, page('Not found', '<h1>Not found</h1>'));
      const meta = `<meta property="og:title" content="${esc(b.title)}"><meta property="og:description" content="${esc(b.landing?.hook)}">`;
      return send(res, 200, page(b.title, `
        <h1>${esc(b.title)}</h1><p class="sub">${esc(b.subtitle)}</p>
        <p>${esc(b.landing?.hook)}</p>
        <ul>${(b.landing?.bullets || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="mute">For: ${esc(b.audience)} · Instant PDF download</p>
        <a class="btn" href="${esc(b.payment?.url)}">Get it for ${money(b.priceCents)}</a>`, meta));
    }

    // Stripe redirects here after payment; we verify the session, then deliver.
    if (url.pathname === '/thanks') {
      const session = await getPaidSession(url.searchParams.get('session_id'));
      const b = session && (getBook(session.metadata?.slug) || listBooks().find((x) => x.payment?.id === session.payment_link));
      if (!b) return send(res, 402, page('Payment not found', '<h1>We could not confirm that payment.</h1><p class="sub">If you were charged, reply to your receipt email.</p>'));
      return send(res, 200, page('Thank you', `<h1>Thank you.</h1><p class="sub">${esc(b.title)} is yours.</p>
        <a class="btn" href="/download?session_id=${esc(session.id)}">Download PDF</a>`));
    }

    if (url.pathname === '/download') {
      const session = await getPaidSession(url.searchParams.get('session_id'));
      const b = session && (getBook(session.metadata?.slug) || listBooks().find((x) => x.payment?.id === session.payment_link));
      if (!b || !fs.existsSync(pdfPath(b.slug))) return send(res, 402, 'Payment required', 'text/plain');
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${b.slug}.pdf"` });
      return fs.createReadStream(pdfPath(b.slug)).pipe(res);
    }

    if (url.pathname === '/webhooks/stripe' && req.method === 'POST') {
      const event = verifyWebhook(await readBody(req), req.headers['stripe-signature']);
      if (!event) return send(res, 400, 'bad signature', 'text/plain');
      if (event.type === 'checkout.session.completed') {
        const s = event.data.object;
        console.log(`[sale] ${s.metadata?.slug} ${money(s.amount_total)} ${s.customer_details?.email || ''}`);
      }
      return send(res, 200, '{"received":true}', 'application/json');
    }

    if (url.pathname === '/admin/run' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${process.env.ADMIN_TOKEN}` || !process.env.ADMIN_TOKEN) {
        return send(res, 401, 'unauthorized', 'text/plain');
      }
      const book = await runAgent();
      return send(res, 200, JSON.stringify({ url: `/b/${book.slug}` }), 'application/json');
    }

    send(res, 404, page('Not found', '<h1>Not found</h1>'));
  } catch (err) {
    console.error(err);
    send(res, 500, 'Something broke. Check the logs.', 'text/plain');
  }
});

server.listen(PORT, () => console.log(`storefront on :${PORT}`));

// Optional autopilot: publish a new book every N hours.
const hours = Number(process.env.AGENT_EVERY_HOURS || 0);
if (hours > 0) setInterval(() => runAgent().catch(console.error), hours * 3600_000);
