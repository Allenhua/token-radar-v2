// Token Radar dashboard: renders window.RADAR (written by main.ts into ../data.js).
// No network, no framework. State lives in the URL hash so a view can be linked:
//   #detail=<slug>  #cat=<category>  #chain=<chain>  #q=<text>  #sort=<key>  #watch=1  #early=1
(function () {
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p style="padding:28px">No data: data.js did not load.</p>'; return; }

  function money(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="pill flat">n/a</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="pill ' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30.4) + ' mo';
    return (days / 365).toFixed(1) + ' yr';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Header + stats
  var totalImplied = D.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  document.getElementById('meta').innerHTML =
    'Snapshot as of <b>' + esc(D.as_of) + '</b><br>Source: DefiLlama protocols<br>Model: <b>' + esc(D.model_version) + '</b>';
  var stats = [
    [D.scanned, 'protocols scanned'],
    [D.pre_token, 'record no token'],
    [D.watchlist_size, 'on the watchlist'],
    [D.board_size, 'rows on the board'],
    [D.early_size, 'early radar finds'],
    [money(totalImplied), 'combined implied value'],
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s, i) {
    return '<div class="stat' + (i === stats.length - 1 ? ' hot' : '') + '"><div class="v">' + s[0] + '</div><div class="k">' + s[1] + '</div></div>';
  }).join('');

  // Model card with the calibrated category multiples
  var topCats = D.categories.slice(0, 10).map(function (c) {
    return '<span class="mult">' + esc(c.category) + ' <b>×' + c.multiple.toFixed(2) + '</b> <span>(n=' + c.samples + ')</span></span>';
  }).join('');
  document.getElementById('modelcard').innerHTML =
    '<h2>How the implied value is derived</h2>' +
    '<p class="formula">implied = TVL &times; category multiple &times; growth factor &times; maturity factor &times; chain factor</p>' +
    '<p>Each protocol is scored from the snapshot alone. ' +
    'The category multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category in this snapshot ' +
    '(each ratio winsorized to 0.02–3.0 so one odd record cannot set a category), ' +
    'shrunk toward the global median (×' + D.global_multiple.toFixed(2) + ') when a category has few samples and capped at ×1.50.</p>' +
    '<p>Growth uses the 7-day TVL change (clamped −50%…+100%, weight 0.35); maturity rewards time tracked with no token (0.70–1.00 over 3 years); ' +
    'each extra chain adds 3% (max 5). A protocol here <em>records</em> no token in DefiLlama — that is the record, not proof none exists.</p>' +
    '<div class="multtable">' + topCats + '</div>';

  // Controls
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var sortEl = document.getElementById('sort');
  var watchEl = document.getElementById('watchonly');
  var earlyEl = document.getElementById('earlyonly');
  var cats = {}, chains = {};
  D.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  catEl.innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');
  chainEl.innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');

  var state = { q: '', cat: '', chain: '', sort: 'rank', watch: false, early: false, detail: null };
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'q') state.q = v;
      if (k === 'cat') state.cat = v;
      if (k === 'chain') state.chain = v;
      if (k === 'sort') state.sort = v;
      if (k === 'watch') state.watch = v === '1';
      if (k === 'early') state.early = v === '1';
      if (k === 'detail') state.detail = v;
    });
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.sort !== 'rank') parts.push('sort=' + state.sort);
    if (state.watch) parts.push('watch=1');
    if (state.early) parts.push('early=1');
    if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
    var h = parts.join('&');
    if (('#' + h) !== location.hash) history.replaceState(null, '', h ? '#' + h : location.pathname);
  }
  function syncControls() {
    qEl.value = state.q; catEl.value = state.cat; chainEl.value = state.chain;
    sortEl.value = state.sort; watchEl.checked = state.watch; earlyEl.checked = state.early;
  }

  function visibleRows() {
    var q = state.q.toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && !r.on_watchlist) return false;
      if (state.early && r.on_watchlist) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
      growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d) || a.rank - b.rank; },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days) || a.rank - b.rank; },
    };
    return rows.sort(by[state.sort] || by.rank);
  }

  // Top-10 concentration chart, following the current filter (log scale, so the
  // smallest of the ten stays visible next to the largest). Figures are computed
  // from the rows in view, never hardcoded.
  function renderTop10() {
    var vis = visibleRows();
    var el = document.getElementById('top10');
    var top = vis.slice(0, 10);
    if (!top.length) {
      el.innerHTML = '<h2>Where the value concentrates</h2><p class="note">No protocol matches these filters.</p>';
      return;
    }
    var vals = top.map(function (r) { return r.implied_value_usd; });
    var lo = Math.log(Math.min.apply(null, vals)), hi = Math.log(Math.max.apply(null, vals));
    var filtered = state.q || state.cat || state.chain || state.watch || state.early;
    var visTotal = vis.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var topTotal = top.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var ratio = Math.round(Math.max.apply(null, vals) / Math.min.apply(null, vals));
    var note = top.length > 1
      ? 'Bar length is on a log scale — the largest here is worth about ' + ratio +
        '× the smallest shown. These ' + top.length + ' hold ' +
        Math.round(100 * topTotal / visTotal) + '% of the ' +
        (filtered ? 'filtered' : 'board\u2019s') + ' combined implied value.'
      : 'Only one protocol in this view.';
    el.innerHTML =
      '<h2>Where the value concentrates <span>top ' + top.length + ' by implied value' + (filtered ? ' · in this view' : '') + '</span></h2>' +
      top.map(function (r) {
        var w = hi === lo ? 100 : Math.min(100, Math.max(6, Math.round(100 * (Math.log(r.implied_value_usd) - lo) / (hi - lo))));
        return '<div class="t10row"><span class="r' + (r.rank === 1 ? ' first' : '') + '">' + r.rank + '</span>' +
          '<span class="n">' + esc(r.name) + '</span>' +
          '<span class="tbar"><i class="' + (r.rank === 1 ? 'top1' : '') + '" style="width:' + w + '%"></i></span>' +
          '<span class="v">' + money(r.implied_value_usd) + '</span></div>';
      }).join('') +
      '<p class="note">' + note + '</p>';
  }

  function renderBoard() {
    var rows = visibleRows();
    document.getElementById('count').textContent = rows.length + ' of ' + D.board_size + ' protocols';
    document.getElementById('empty').hidden = rows.length > 0;
    document.getElementById('rows').innerHTML = rows.map(function (r) {
      var badge = r.on_watchlist
        ? '<span class="badge watch">watchlist</span>'
        : '<span class="badge early">early</span>';
      var cls = r.rank === 1 ? 'r1' : r.rank === 2 ? 'r2' : r.rank === 3 ? 'r3' : '';
      if (state.detail === r.slug) cls += (cls ? ' ' : '') + 'sel';
      return '<tr data-slug="' + esc(r.slug) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' +
        '<td class="num"><span class="rank">' + r.rank + '</span></td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badge +
        '<div class="psub">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) + ' more' : '') + '</div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#rows tr'), function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug');
        writeHash(); renderBoard(); renderDetail();
      });
    });
  }

  function factorBar(label, value, max, note) {
    var w = Math.max(2, Math.min(100, Math.round(100 * value / max)));
    return '<div class="factor"><div class="flabel"><span>' + label + '</span><b>' + value.toFixed(2) + '</b></div>' +
      '<div class="fbar"><i style="width:' + w + '%"></i></div><div class="psub">' + note + '</div></div>';
  }

  function renderDetail() {
    var el = document.getElementById('detail');
    var vis = visibleRows();
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === state.detail) r = x; });
    if (!r || vis.indexOf(r) < 0) r = vis[0] || D.rows[0];
    if (!r) { el.innerHTML = ''; return; }
    if (state.detail !== r.slug) { state.detail = r.slug; writeHash(); }
    var m = r.model;
    var peers = D.live.filter(function (l) { return l.category === r.category; }).slice(0, 4);
    var peerHtml = peers.length
      ? '<h3>Live peers in ' + esc(r.category || 'this category') + '</h3><div class="peers">' +
        peers.map(function (l) {
          return '<div><b>' + esc(l.name) + '</b> — mcap ' + money(l.mcap_usd) + ' on TVL ' + money(l.tvl_usd) + ' (×' + l.mcap_tvl_ratio.toFixed(2) + ')</div>';
        }).join('') + '</div>'
      : '';
    var chainChips = r.chains.slice(0, 6).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') +
      (r.chains.length > 6 ? '<span>+' + (r.chains.length - 6) + ' more</span>' : '');
    el.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="dsub">#' + r.rank + ' · ' + esc(r.category || 'Uncategorized') +
      (r.on_watchlist ? ' · watchlist' : ' · early radar') + '</div>' +
      '<div class="chips">' + chainChips + '</div>' +
      '<div class="kv"><span>Implied token value</span><b>' + money(r.implied_value_usd) + '</b></div>' +
      '<div class="kv"><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div class="kv"><span>7-day TVL change</span><b>' + (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(2) + '%') + '</b></div>' +
      '<div class="kv"><span>Tracked since</span><b>' + esc(r.listed_at || 'not reported') + ' (' + ageText(r.age_days) + ')</b></div>' +
      '<div class="kv"><span>Token recorded</span><b>none</b></div>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<h3>Model breakdown</h3>' +
      factorBar('Category multiple (' + m.category_samples + ' live samples)', m.category_multiple, 1.5, 'Median mcap/TVL of live ' + esc(r.category || 'Uncategorized') + ' protocols, shrunk to the global median.') +
      factorBar('Growth factor', m.growth_factor, 1.4, 'From the 7-day change of ' + m.growth_pct.toFixed(1) + '% (clamped −50…+100, weight 0.35).') +
      factorBar('Maturity factor', m.maturity_factor, 1.0, 'Time tracked with no token recorded; full weight at 3 years.') +
      factorBar('Chain factor', m.chain_factor, 1.15, r.chains.length + ' chain(s) counted by DefiLlama; +3% per extra chain, max 5.') +
      peerHtml;
  }

  function renderLive() {
    document.getElementById('live').innerHTML =
      '<h2>Calibration set: tokens that already trade</h2>' +
      '<p>These protocols already have tokens, so they are never ranked on the board. Their market-cap-to-TVL ratios are what the model above is calibrated on — shown here so the multiples can be checked, not trusted.</p>' +
      '<div class="livegrid">' + D.live.map(function (l) {
        return '<div class="livecard"><div class="n">' + esc(l.name) + '</div>' +
          '<div class="r">' + esc(l.category || 'Uncategorized') + '</div>' +
          '<div class="r">mcap <b>' + money(l.mcap_usd) + '</b> · TVL ' + money(l.tvl_usd) + '</div>' +
          '<div class="r">mcap / TVL <b>×' + l.mcap_tvl_ratio.toFixed(2) + '</b> · 7d ' + (l.change_7d === null ? 'n/a' : l.change_7d.toFixed(1) + '%') + '</div></div>';
      }).join('') + '</div>';
  }

  document.getElementById('foot').innerHTML =
    '<p><b>Method.</b> The board ranks every protocol on the snapshot watchlist (' + D.watchlist_size + ') plus ' + D.early_size +
    ' earlier finds below the ' + money(D.floor_usd) + ' watchlist floor that record no token and are not wrapped, staked, bridged or versioned products of a token that already trades. ' +
    'Implied value is this entry\u2019s own claim from the formula above, never a prediction that a token will be issued.</p>' +
    '<p><b>Reading the record.</b> "Records no token" means DefiLlama\u2019s record carries no market cap, CoinGecko id or symbol for the protocol as of ' + esc(D.as_of) +
    '; a protocol may still have a token its record does not carry. Farm plans are generic playbooks derived from each protocol\u2019s category, chains, TVL and age — check the protocol\u2019s own documentation before putting funds anywhere.</p>';

  function refresh() { writeHash(); renderBoard(); renderTop10(); renderDetail(); }
  qEl.addEventListener('input', function () { state.q = qEl.value; refresh(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; refresh(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; refresh(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; refresh(); });
  watchEl.addEventListener('change', function () { state.watch = watchEl.checked; refresh(); });
  earlyEl.addEventListener('change', function () { state.early = earlyEl.checked; refresh(); });

  readHash();
  syncControls();
  renderBoard();
  renderTop10();
  renderDetail();
  renderLive();
})();
