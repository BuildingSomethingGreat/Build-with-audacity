// The agent: pick a niche -> write the book -> render PDF -> sell it -> advertise it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask, parseJson } from '../lib/claude.js';
import { renderPdf } from '../lib/pdf.js';
import { createPaymentLink } from '../lib/stripe.js';
import { launchAd } from '../lib/meta.js';
import { listBooks, saveBook } from '../lib/books.js';

const SYSTEM = `You are an indie publisher who makes short, genuinely useful micro-books.
Rules: practical and specific; no fluff; no income, health, or guaranteed-results claims;
ad copy must be honest and comply with Meta advertising policies.`;

function prompt(seeds, existing) {
  return `Seed themes: ${seeds}
Already published (do not repeat): ${existing.join('; ') || 'none'}

1. Choose ONE specific, underserved topic inside a seed theme, for a clearly defined reader.
2. Decide if it works best as a "guide" (how-to) or a "journal" (guided prompts).
3. Write it.

Return ONLY JSON:
{
  "title": "", "subtitle": "", "kind": "guide|journal", "audience": "",
  "chapters": [{"title": "", "body": "350-500 words, plain text, paragraphs separated by blank lines"}],
  "prompts": ["journal only: 20 reflective prompts, else empty array"],
  "landing": {"hook": "one sentence", "bullets": ["3-5 concrete things the reader gets"]},
  "ad": {"headline": "max 40 chars", "primaryText": "max 125 chars", "description": "max 30 chars"}
}
Guides: 5-7 chapters. Journals: 2 short intro chapters plus prompts.`;
}

// Used when no API key is set, so the pipeline can be demoed offline.
const SAMPLE = {
  title: 'The First 30 Days',
  subtitle: 'A pocket guide for brand-new managers',
  kind: 'guide',
  audience: 'People promoted into their first management role',
  chapters: [
    { title: 'Week One: Listen', body: 'Your first job is not to change anything. Meet each person one-on-one and ask three questions: what is working, what is not, and what they wish their last manager had done.\n\nWrite down every answer.' },
    { title: 'Week Two: Clarify', body: 'Turn what you heard into a one-page summary of priorities. Share it and ask what you got wrong.' },
    { title: 'Week Three: One Small Win', body: 'Pick one annoying, fixable problem the team named and remove it. Credibility comes from small wins delivered quickly.' },
  ],
  prompts: [],
  landing: { hook: 'You got the promotion. Here is what to do on Monday.', bullets: ['A day-by-day first month plan', 'The three questions for every one-on-one', 'How to earn trust without big speeches'] },
  ad: { headline: 'New manager? Start here.', primaryText: 'A short, practical guide to your first 30 days leading a team.', description: 'Instant PDF download' },
};

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function runAgent() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  const existing = listBooks().map((b) => b.title);

  console.log('[agent] 1/4 writing book…');
  const draft = process.env.ANTHROPIC_API_KEY
    ? parseJson(await ask(prompt(process.env.NICHE_SEEDS || 'practical life skills', existing), { system: SYSTEM }))
    : (console.log('[agent] no ANTHROPIC_API_KEY: using sample book'), SAMPLE);

  let slug = slugify(draft.title);
  if (existing.some((t) => slugify(t) === slug)) slug += `-${Date.now().toString(36)}`;
  const book = {
    ...draft,
    slug,
    priceCents: Number(process.env.BOOK_PRICE_CENTS || 900),
    createdAt: new Date().toISOString(),
  };

  console.log('[agent] 2/4 rendering PDF…');
  const dir = saveBook(book);
  await renderPdf(book, path.join(dir, 'book.pdf'));

  console.log('[agent] 3/4 creating Stripe payment link…');
  book.payment = await createPaymentLink(book, baseUrl);
  saveBook(book);

  console.log('[agent] 4/4 launching Meta ad…');
  try {
    book.ads = await launchAd(book, `${baseUrl}/b/${book.slug}`);
  } catch (err) {
    book.ads = { error: err.message };
    console.error('[agent] ad failed (book is still on sale):', err.message);
  }
  saveBook(book);

  console.log(`[agent] done -> ${baseUrl}/b/${book.slug}`);
  return book;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgent().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
