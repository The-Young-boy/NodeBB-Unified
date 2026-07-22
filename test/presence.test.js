// בדיקת מנגנון חיווי הנוכחות (סימן TAG נסתר + הזרקה).
// משכפלת את הפונקציות הטהורות מ-NodeBB-Unified.user.js (מודול presence) - לעדכן יחד.
// הרצה: node test/presence.test.js

const assert = require('assert');

const MAGIC = 'nbbu';
const VERSION = 1;
const TAG_BASE = 0xE0000;

function buildMarker() {
    let out = '';
    for (const ch of MAGIC + VERSION) out += String.fromCodePoint(TAG_BASE + ch.charCodeAt(0));
    return out;
}
const MARKER = buildMarker();

function decodeMarker(text) {
    if (!text) return null;
    let ascii = '';
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp >= TAG_BASE && cp <= TAG_BASE + 0x7f) ascii += String.fromCharCode(cp - TAG_BASE);
    }
    if (!ascii.startsWith(MAGIC)) return null;
    const ver = parseInt(ascii.slice(MAGIC.length), 10);
    return { version: Number.isFinite(ver) ? ver : 0 };
}
const hasMarker = t => !!decodeMarker(t);

const WRITE_RE = /\/api\/v3\/(topics(\/\d+)?|posts\/\d+|chats\/\d+)\/?(\?.*)?$/;

function injectIntoBody(bodyStr) {
    if (typeof bodyStr !== 'string' || !bodyStr) return bodyStr;
    let data;
    try { data = JSON.parse(bodyStr); } catch { return bodyStr; }
    if (!data || typeof data !== 'object') return bodyStr;
    const field = typeof data.content === 'string' ? 'content'
        : (typeof data.message === 'string' ? 'message' : null);
    if (!field) return bodyStr;
    if (hasMarker(data[field])) return bodyStr;
    data[field] = data[field] + MARKER;
    try { return JSON.stringify(data); } catch { return bodyStr; }
}

// --- הסימן בלתי-נראה (רק תווי-TAG, אורך אפס בתצוגה אך תווים אמיתיים) ---
assert.strictEqual([...MARKER].length, 5, 'nbbu1 = 5 תווי-TAG');
assert.ok(!/[\x20-\x7e]/.test(MARKER), 'הסימן לא מכיל ASCII נראה');

// --- round-trip ---
assert.deepStrictEqual(decodeMarker(MARKER), { version: 1 });
assert.strictEqual(hasMarker('שלום עולם'), false, 'טקסט רגיל בלי סימן');
assert.strictEqual(hasMarker('היי' + MARKER), true, 'מזהה סימן בסוף טקסט');
assert.strictEqual(hasMarker('א' + MARKER + 'ב'), true, 'מזהה סימן באמצע טקסט');

// --- הזרקה: content (פוסט/עריכה) ---
const post = injectIntoBody(JSON.stringify({ content: 'תוכן פוסט' }));
assert.ok(hasMarker(JSON.parse(post).content), 'הוזרק ל-content');
// idempotent - קריאה שנייה לא מוסיפה עוד סימן
assert.strictEqual(injectIntoBody(post), post, 'הזרקה כפולה נמנעת');
assert.strictEqual([...JSON.parse(post).content].filter(c => c.codePointAt(0) >= TAG_BASE).length, 5, 'סימן יחיד');

// --- הזרקה: message (צ'אט) ---
const chat = injectIntoBody(JSON.stringify({ message: 'הודעה' }));
assert.ok(hasMarker(JSON.parse(chat).message), 'הוזרק ל-message');

// --- גוף לא רלוונטי / לא-JSON נשאר כמו שהוא ---
assert.strictEqual(injectIntoBody('not json'), 'not json');
assert.strictEqual(injectIntoBody(JSON.stringify({ foo: 'bar' })), JSON.stringify({ foo: 'bar' }), 'בלי content/message');

// --- זיהוי endpoints של write ---
['/api/v3/topics', '/api/v3/topics/123', '/api/v3/posts/456', '/api/v3/chats/789',
 'https://mitmachim.top/api/v3/chats/789?foo=1'].forEach(u =>
    assert.ok(WRITE_RE.test(u), 'צריך להתאים: ' + u));
['/api/v3/users/1', '/api/config', '/api/v3/topics/123/tags', '/api/user/x/posts',
 '/api/v3/posts/456/raw'].forEach(u => // חשוב: GET raw של פוסט לא נגוע ע"י ההזרקה
    assert.ok(!WRITE_RE.test(u), 'לא צריך להתאים: ' + u));

console.log('✅ בדיקת חיווי הנוכחות עברה');
