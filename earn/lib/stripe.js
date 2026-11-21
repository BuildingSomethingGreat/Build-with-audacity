// Tiny Stripe client over fetch: products, prices, payment links, sessions, webhooks.
import crypto from 'node:crypto';

const enabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

// Flatten nested objects into Stripe's form encoding: a[b][0][c]=v
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') form(v, key, out);
    else if (v !== undefined) out.append(key, String(v));
  }
  return out;
}

async function call(method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    body: body ? form(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message}`);
  return data;
}

export async function createPaymentLink(book, baseUrl) {
  if (!enabled()) {
    console.log('[stripe] dry-run: would create product + payment link for', book.title);
    return { id: 'plink_dry_run', url: `${baseUrl}/b/${book.slug}#dry-run` };
  }
  const product = await call('POST', '/products', {
    name: book.title,
    description: book.subtitle,
    metadata: { slug: book.slug },
  });
  const price = await call('POST', '/prices', {
    product: product.id,
    unit_amount: book.priceCents,
    currency: 'usd',
  });
  const link = await call('POST', '/payment_links', {
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { slug: book.slug }, // copied onto each checkout session
    after_completion: {
      type: 'redirect',
      redirect: { url: `${baseUrl}/thanks?session_id={CHECKOUT_SESSION_ID}` },
    },
  });
  return { id: link.id, url: link.url };
}

export async function getPaidSession(sessionId) {
  if (!enabled() || !/^cs_[\w]+$/.test(sessionId || '')) return null;
  const s = await call('GET', `/checkout/sessions/${sessionId}`);
  return s.payment_status === 'paid' ? s : null;
}

// Verify the Stripe-Signature header (HMAC-SHA256, 5-minute tolerance).
export function verifyWebhook(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return null;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const ok =
    parts.v1?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected)) &&
    Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  return ok ? JSON.parse(rawBody) : null;
}
