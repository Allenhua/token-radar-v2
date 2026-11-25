// Token radar model: turns the sealed DefiLlama snapshot into a ranked board of
// protocols that record no token, each with an implied token value and a farm plan.
//
// The implied value is calibrated from the snapshot itself. For every category we
// measure how the market values the live-token protocols in that same category
// (median market cap / TVL), shrink small samples toward the global median, then
// apply a growth factor (7-day TVL change), a maturity factor (days tracked with
// no token) and a small multi-chain factor. One function scores every protocol;
// no name is special-cased.
//
//   category_multiple = (n * median_category + 6 * median_global) / (n + 6), capped at 1.5
//   (each live ratio winsorized to [0.02, 3] before the medians)
//   implied = tvl * category_multiple * growth_factor * maturity_factor * chain_factor

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_samples: number;
    growth_pct: number;
    growth_factor: number;
    maturity_factor: number;
    chain_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl_ratio: number;
  change_7d: number | null;
}

export interface CategoryStat {
  category: string;
  samples: number;
  median_ratio: number;
  multiple: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  scanned: number;
  pre_token: number;
  global_multiple: number;
  categories: CategoryStat[];
  rows: BoardRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'radar-calibrated-1';
export const EARLY_ROWS = 170;
export const LIVE_ROWS = 24;
const SHRINK_K = 6;
const RATIO_FLOOR = 0.02;
const RATIO_CAP = 3;
const MULTIPLE_CAP = 1.5;
const DAY_MS = 86_400_000;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || num(p.tvl_usd) === null) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks slug, name or TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);

/** Mirrors the watchlist rule: a product of a token that already trades is not a future launch. */
export function isProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Market-cap-to-TVL medians from the snapshot's live-token protocols, per category and global. */
export function categoryMultiples(snapshot: Snapshot): { global: number; byCategory: Map<string, CategoryStat> } {
  const all: number[] = [];
  const grouped = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    // Winsorize: a token whose counted TVL is a sliver of its market cap would
    // otherwise set a whole category's multiple from a single record.
    const winsorized = Math.min(RATIO_CAP, Math.max(RATIO_FLOOR, ratio));
    all.push(winsorized);
    const key = p.category ?? 'Uncategorized';
    const list = grouped.get(key) ?? [];
    list.push(winsorized);
    grouped.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.25;
  const byCategory = new Map<string, CategoryStat>();
  for (const [category, ratios] of grouped) {
    const med = median(ratios);
    const multiple = Math.min(MULTIPLE_CAP, (ratios.length * med + SHRINK_K * global) / (ratios.length + SHRINK_K));
    byCategory.set(category, {
      category,
      samples: ratios.length,
      median_ratio: round4(med),
      multiple: round4(multiple),
    });
  }
  return { global: round4(global), byCategory };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export interface Scored {
  implied: number;
  categoryMultiple: number;
  categorySamples: number;
  growthPct: number;
  growthFactor: number;
  maturityFactor: number;
  chainFactor: number;
  age: number | null;
}

export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { global: number; byCategory: Map<string, CategoryStat> },
): Scored {
  const stat = multiples.byCategory.get(p.category ?? 'Uncategorized');
  const categoryMultiple = stat ? stat.multiple : multiples.global;
  const categorySamples = stat ? stat.samples : 0;
  const growthPct = clamp(p.change_7d ?? 0, -50, 100);
  const growthFactor = 1 + (growthPct / 100) * 0.35;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? 365;
  const maturityFactor = 0.7 + 0.3 * (Math.min(ageForModel, 1095) / 1095);
  const chainFactor = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * categoryMultiple * growthFactor * maturityFactor * chainFactor),
  );
  return {
    implied,
    categoryMultiple: round4(categoryMultiple),
    categorySamples,
    growthPct: round4(growthPct),
    growthFactor: round4(growthFactor),
    maturityFactor: round4(maturityFactor),
    chainFactor: round4(chainFactor),
    age,
  };
}

function capitalTier(tvl: number): number {
  if (tvl >= 2_000_000_000) return 500;
  if (tvl >= 500_000_000) return 250;
  if (tvl >= 100_000_000) return 150;
  if (tvl >= 25_000_000) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('money market')) {
    return `Supply $${capital} of USDC (or the chain's main stablecoin) to ${name} on ${chain}, then borrow a small amount against it and repay within the week so the wallet shows both sides of the market.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) {
    return `Add $${capital} of liquidity to ${name}'s deepest stablecoin pool on ${chain}, and route two or three small swaps through the same wallet each week so it reads as an active trader, not a parked LP.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name}, open one small delta-neutral hedge (long spot elsewhere, short perp here), and close and reopen it weekly to build volume without directional risk.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('yield')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the wallet; add a small top-up every week instead of one lump sum, which most points systems reward more.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} worth of the staking asset through ${name} on ${chain} and hold the liquid receipt token; do not unstake early, since most snapshots weight continuous staking time.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC through ${name} to ${chain} and then use the bridged funds inside the destination app, because bridge points usually count completed routes, not idle balances.`;
  }
  if (c.includes('rwa') || c.includes('treasury')) {
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the wallet; RWA programs typically reward holders at snapshot time rather than traders.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of ${name}'s stable asset on ${chain} and keep it in the wallet or in the protocol's own savings module, which is where stablecoin issuers usually measure balances.`;
  }
  if (c.includes('prediction') || c.includes('betting')) {
    return `Fund the wallet with $${capital} and place small positions on ${name} across several different markets, since prediction platforms usually score distinct markets traded, not size.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover through ${name} on ${chain} and keep the policy active for its full term; renewing once is worth more than a single large policy in most reward designs.`;
  }
  if (c.includes('nft') || c.includes('gaming') || c.includes('social')) {
    return `Use ${name} on ${chain} the way a real user would: complete its core action with about $${capital} of working funds and repeat it weekly, because consumer apps score distinct active days.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open; repeat the protocol's core action once a week from the same wallet so the activity history is continuous.`;
}

/** A concrete farm plan: wallet hygiene, the core action, weekly activity, hold, claim safety, log. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(age);
  const gas = capital >= 250 ? 10 : capital >= 100 ? 6 : 3;
  const steps = [
    `Start from a fresh wallet used only for farming ${p.name}; fund it once from an exchange withdrawal and write the seed phrase on paper, never in a cloud note. Cost: about $${gas} of gas for the first transactions. Time: 10 minutes.`,
    `${mainAction(p, capital, chain)} Cost: $${capital} of working capital plus roughly $${gas} of gas. Time: 20 minutes to set up.`,
    `Repeat one qualifying action every week (deposit, borrow, swap, vote or trade, whichever ${p.name} counts) and vary the amount slightly; identical round amounts every week look automated. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days. ${p.name} has been tracked for ${age === null ? 'an unreported number of' : age} days with no token recorded, so a longer hold covers more snapshot windows. Cost: the $${capital} stays deployed. Time: ${hold} days.`,
    `Once a month, check ${p.name}'s own site and its verified social accounts for a points page or a token announcement, and only ever connect the wallet from links on the official site. Cost: nothing; never pay a fee to claim an airdrop. Time: 5 minutes a month.`,
    `Keep a farm log with the wallet address, dates, amounts and transaction hashes for ${p.name}; if a claim opens with a deadline, the log tells you exactly which wallet and position qualify. Cost: nothing but the log. Time: 5 minutes per entry.`,
    `When you exit, unwind in the reverse order (repay borrows first, then withdraw) and leave a small balance behind; some programs snapshot again after the first claim. Cost: about $${gas} of gas. Time: 15 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; multiples: ReturnType<typeof categoryMultiples> } {
  const multiples = categoryMultiples(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && recordsNoToken(p) && !isProduct(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, multiples) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const watch = new Set(snapshot.watchlist);
  const board = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMultiple,
      category_samples: s.categorySamples,
      growth_pct: s.growthPct,
      growth_factor: s.growthFactor,
      maturity_factor: s.maturityFactor,
      chain_factor: s.chainFactor,
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age),
  }));
  return { board, multiples };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      mcap_tvl_ratio: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const categories = [...multiples.byCategory.values()].sort((a, b) => b.samples - a.samples);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    scanned: snapshot.protocols.length,
    pre_token: snapshot.protocols.filter(recordsNoToken).length,
    global_multiple: multiples.global,
    categories,
    rows: board,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, needs 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'board has a duplicate slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all rows share one implied value';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
