// בדיקת הדירוג החכם (מודול "reputation-ranking").
// משכפלת את נוסחת computeSmartScores מ-NodeBB-Unified.user.js - לעדכן את שניהם יחד.
// נועלת את הכוונה: עולה-מהיר > ספאמר > ותיק-שהפסיק-לכתוב.
// הרצה: node test/ranking.test.js

const assert = require('assert');

const CONFIG_scoring = {
    bayesConfidence: 20,
    recencyHalfLifeDays: 365,
    recencySeverity: 1.0,
    weights: { quality: 0.55, volume: 0.30, activeSpan: 0.15 }, // קומפוזיט רזה
};

function percentileMap(values) {
    const n = values.length;
    if (n <= 1) return values.map(() => 0.5);
    const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const pct = new Array(n);
    let i = 0;
    while (i < n) {
        let j = i;
        while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j += 1;
        const p = ((i + j) / 2) / (n - 1);
        for (let k = i; k <= j; k += 1) pct[idx[k]] = p;
        i = j + 1;
    }
    return pct;
}

// now מוזרק לצורך דטרמיניזם (בקוד עצמו: Date.now())
function computeSmartScores(users, now) {
    const cfg = CONFIG_scoring;
    const DAY = 86400000;
    const pool = users.filter(u => u?.userslug && !u.banned && !u.deleted && !u.muted);
    if (!pool.length) return [];

    let sumR = 0, sumP = 0;
    for (const u of pool) { sumR += Math.max(0, u.reputation); sumP += Math.max(0, u.postcount); }
    const m = sumP > 0 ? sumR / sumP : 0;

    const raw = pool.map(u => {
        const R = Math.max(0, u.reputation);
        const P = Math.max(0, u.postcount);
        const idleDays = u.lastonline > 0 ? Math.max(0, (now - u.lastonline) / DAY) : 0;
        const spanDays = (u.lastonline > 0 && u.joindate > 0)
            ? Math.max(0, (u.lastonline - u.joindate) / DAY) : 0;
        return {
            u,
            quality: (R + cfg.bayesConfidence * m) / (P + cfg.bayesConfidence),
            volume: Math.log10(1 + R),
            activeSpan: spanDays,
            recency: Math.pow(0.5, (idleDays / cfg.recencyHalfLifeDays) * cfg.recencySeverity),
        };
    });

    const comps = ['quality', 'volume', 'activeSpan'];
    const pcts = {};
    for (const c of comps) pcts[c] = percentileMap(raw.map(r => r[c]));

    const scored = raw.map((r, i) => {
        let base = 0;
        for (const c of comps) base += cfg.weights[c] * pcts[c][i];
        return { ...r.u, smartScore: base * r.recency };
    });
    scored.sort((a, b) => b.smartScore - a.smartScore);
    return scored;
}

function ranksBySlug(scored) {
    const map = {};
    scored.forEach((u, i) => { map[u.userslug] = i + 1; });
    return map;
}

// ---- אוכלוסיית בדיקה ----
const NOW = 1_700_000_000_000;
const DAY = 86400000;
const U = (userslug, reputation, postcount, ageDays, idleDays) => ({
    userslug, username: userslug, reputation, postcount,
    topiccount: 0, profileviews: 0, followerCount: 0, // כמו רשימת ה-API האמיתית
    joindate: NOW - ageDays * DAY,
    lastonline: NOW - idleDays * DAY,
    banned: false, deleted: false, muted: false,
});

const users = [
    U('fastriser', 3000, 200, 400, 1),     // מוניטין גבוה, מעט פוסטים, צעיר, פעיל
    U('veteranleft', 5000, 8000, 3650, 730), // ותיק ענק שהפסיק לכתוב לפני שנתיים
    U('spammer', 2500, 9000, 1000, 2),      // אלפי פוסטים, לייק בודד לכל אחד, פעיל
    U('filler1', 600, 1200, 1500, 40),
    U('filler2', 1200, 900, 700, 15),
];

const scored = computeSmartScores(users, NOW);
const rank = ranksBySlug(scored);

console.log('דירוג:', scored.map(u => `${u.userslug}(#${rank[u.userslug]}, ${u.smartScore.toFixed(3)})`).join('  '));

// עולה-מהיר במקום הראשון - מעל הספאמר ומעל הותיק-שעזב (הכוונה המקורית של המשתמש)
assert.strictEqual(rank.fastriser, 1, 'עולה-מהיר חייב להיות #1');
assert.ok(rank.fastriser < rank.spammer, 'עולה-מהיר מעל ספאמר');
assert.ok(rank.fastriser < rank.veteranleft, 'עולה-מהיר מעל ותיק-שעזב');
// הרעננות מטביעה את הותיק שנעלם - נמוך גם מהספאמר הפעיל
assert.ok(rank.veteranleft > rank.spammer, 'ותיק-רדום (שנתיים) שוקע מתחת לספאמר פעיל');
// סינון banned
assert.strictEqual(computeSmartScores([...users, U('x', 9999, 1, 10, 1)].map((u, i) =>
    i === 5 ? { ...u, banned: true } : u), NOW).find(u => u.userslug === 'x'), undefined, 'banned מסונן');

console.log('✅ בדיקת הדירוג החכם עברה');
