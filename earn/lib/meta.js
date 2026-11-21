// Meta Marketing API: campaign -> ad set -> creative -> ad.
// Safe by default: everything is created PAUSED and the budget is hard-capped.

const env = (k, d) => process.env[k] || d;

async function graph(path, params) {
  const url = `https://graph.facebook.com/${env('META_API_VERSION', 'v23.0')}/${path}`;
  const body = new URLSearchParams({ access_token: process.env.META_ACCESS_TOKEN });
  for (const [k, v] of Object.entries(params)) {
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json();
  if (data.error) throw new Error(`Meta: ${data.error.message}`);
  return data;
}

export async function launchAd(book, landingUrl) {
  const ready = ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID'].every((k) => process.env[k]);
  const budget = Math.min(
    Number(env('META_DAILY_BUDGET_CENTS', 500)),
    Number(env('META_MAX_DAILY_BUDGET_CENTS', 1000)),
  );
  const status = env('META_AUTO_ACTIVATE', 'false') === 'true' ? 'ACTIVE' : 'PAUSED';

  if (!ready) {
    console.log(`[meta] dry-run: would create a ${status} ad at $${budget / 100}/day ->`, book.ad.headline);
    return { dryRun: true };
  }

  const act = `act_${process.env.META_AD_ACCOUNT_ID}`;
  const name = `MicroBook: ${book.title}`.slice(0, 100);

  const campaign = await graph(`${act}/campaigns`, {
    name,
    objective: 'OUTCOME_TRAFFIC',
    status,
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });

  const adset = await graph(`${act}/adsets`, {
    name,
    campaign_id: campaign.id,
    daily_budget: budget,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: {
      geo_locations: { countries: env('META_COUNTRIES', 'US').split(',') },
      age_min: 18,
      targeting_automation: { advantage_audience: 1 },
    },
    status,
  });

  // Meta pulls the image from the landing page's og:image unless you upload one.
  const creative = await graph(`${act}/adcreatives`, {
    name,
    object_story_spec: {
      page_id: process.env.META_PAGE_ID,
      link_data: {
        link: landingUrl,
        message: book.ad.primaryText,
        name: book.ad.headline,
        description: book.ad.description,
        call_to_action: { type: 'LEARN_MORE', value: { link: landingUrl } },
      },
    },
  });

  const ad = await graph(`${act}/ads`, {
    name,
    adset_id: adset.id,
    creative: { creative_id: creative.id },
    status,
  });

  console.log(`[meta] created ${status} ad ${ad.id} at $${budget / 100}/day`);
  return { campaignId: campaign.id, adsetId: adset.id, adId: ad.id, status };
}
