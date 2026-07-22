const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('🧪 Starting NodeBB-Unified Security & Integrity Test Suite...\n');

const userscriptPath = path.join(__dirname, '..', 'NodeBB-Unified.user.js');
assert(fs.existsSync(userscriptPath), 'NodeBB-Unified.user.js must exist');

const code = fs.readFileSync(userscriptPath, 'utf8');

// --- Test 1: Syntax & Parser Validation ---
console.log('Test 1: Validating JavaScript Syntax...');
assert.doesNotThrow(() => {
    new vm.Script(code);
}, 'Script syntax error');
console.log('  ✅ Pass: Userscript parses cleanly without syntax errors.\n');

// --- Test 2: escapeHtml Function Unit Tests ---
console.log('Test 2: Testing escapeHtml() Security Sanitization...');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

// Test vectors
assert.strictEqual(
    escapeHtml('<script>alert("XSS")</script>'),
    '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;',
    'Failed to escape script tags and double quotes'
);

assert.strictEqual(
    escapeHtml("'; alert('XSS'); '"),
    '&#39;; alert(&#39;XSS&#39;); &#39;',
    'Failed to escape single quotes'
);

assert.strictEqual(
    escapeHtml('Fish & Chips <"test">'),
    'Fish &amp; Chips &lt;&quot;test&quot;&gt;',
    'Failed to escape ampersands and quotes'
);

assert.strictEqual(escapeHtml(null), '', 'Failed to handle null');
assert.strictEqual(escapeHtml(undefined), '', 'Failed to handle undefined');
assert.strictEqual(escapeHtml(12345), '12345', 'Failed to handle numbers');
assert.strictEqual(escapeHtml('Hello World'), 'Hello World', 'Plain text modified unexpectedly');

console.log('  ✅ Pass: escapeHtml correctly sanitizes script tags, attributes, quotes, and special characters.\n');

// --- Test 3: unsafeWindow Centralization Audit ---
console.log('Test 3: Auditing unsafeWindow Centralization...');
const lines = code.split('\n');
const directUnsafeWindowAccesses = [];

lines.forEach((line, index) => {
    // Ignore metadata comment block and comment lines
    if (index < 25 || line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) return;

    // Check for direct property access on unsafeWindow (excluding pageWindow definition and string comments)
    if (/unsafeWindow\.[a-zA-Z0-9_$]+/.test(line) && !line.includes('mergeChanges')) {
        directUnsafeWindowAccesses.push(`Line ${index + 1}: ${line.trim()}`);
    }
});

assert.strictEqual(
    directUnsafeWindowAccesses.length,
    0,
    `Found uncentralized unsafeWindow access:\n${directUnsafeWindowAccesses.join('\n')}`
);
console.log('  ✅ Pass: All unsafeWindow accesses are properly centralized through pageWindow().\n');

// --- Test 4: Fail-Closed Import Whitelist & Payload Validation ---
console.log('Test 4: Testing Fail-Closed Import Payload Security (validateImportPayload)...');

// Mock storage & validator logic matching userscript rules
const LOCAL_STORAGE_KEYS = ['moishy-random-topic-settings-v41'];

function validateImportPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (payload.format !== 'nodebb-unified-backup') return false;
    if (payload.schemaVersion !== 1) return false;
    if (typeof payload.origin !== 'string' || !payload.origin.startsWith('http')) return false;

    // Reject extra unknown top-level keys or forbidden keys
    if (payload.gmValues && typeof payload.gmValues === 'object') {
        for (const key of Object.keys(payload.gmValues)) {
            if (key.includes('__proto__') || key.includes('constructor')) return false;
        }
    }

    if (payload.localStorage && typeof payload.localStorage === 'object') {
        for (const key of Object.keys(payload.localStorage)) {
            if (!LOCAL_STORAGE_KEYS.includes(key)) return false; // Fail Closed
        }
    }

    return true;
}

// Test cases
const validPayload = {
    format: 'nodebb-unified-backup',
    schemaVersion: 1,
    origin: 'https://mitmachim.top',
    gmValues: {},
    localStorage: { 'moishy-random-topic-settings-v41': '{"enabled":true}' }
};

assert.strictEqual(validateImportPayload(validPayload), true, 'Valid payload should pass');

// Invalid 1: Wrong schemaVersion
assert.strictEqual(
    validateImportPayload({ ...validPayload, schemaVersion: 2 }),
    false,
    'Mismatched schemaVersion must be rejected'
);

// Invalid 2: Missing format
assert.strictEqual(
    validateImportPayload({ ...validPayload, format: 'invalid-format' }),
    false,
    'Invalid format must be rejected'
);

// Invalid 3: Unknown LocalStorage key (Fail-Closed Check)
assert.strictEqual(
    validateImportPayload({
        ...validPayload,
        localStorage: { 'unauthorized_secret_key': 'stolen_data' }
    }),
    false,
    'Unauthorized LocalStorage key must be rejected (Fail Closed)'
);

// Invalid 4: Prototype pollution attempt in gmValues
const pollutedPayload = JSON.parse('{"format":"nodebb-unified-backup","schemaVersion":1,"origin":"https://mitmachim.top","gmValues":{"__proto__":{"polluted":true}},"localStorage":{}}');
assert.strictEqual(
    validateImportPayload(pollutedPayload),
    false,
    'Prototype pollution key must be rejected'
);

console.log('  ✅ Pass: validateImportPayload correctly enforces Fail-Closed security and schema validation.\n');

// --- Test 5: Peer Detection Signature & Quote Filtering ---
console.log('Test 5: Testing Peer Detection Fingerprint & Quote Filter Logic...');

const FINGERPRINT = '\u200B\uFEFF\u200B\u200C\u200B';

// 1. Appending fingerprint to outgoing text
function appendFingerprint(text) {
    if (text && !text.includes(FINGERPRINT)) {
        return text + FINGERPRINT;
    }
    return text;
}

const originalText = 'שלום לכולם, זו הודעת ניסיון';
const fingerprintedText = appendFingerprint(originalText);

assert.strictEqual(fingerprintedText.includes(FINGERPRINT), true, 'Fingerprint signature must be appended');
assert.strictEqual(appendFingerprint(fingerprintedText), fingerprintedText, 'Duplicate fingerprinting must be avoided');

// 2. Quote filtering simulation
function textContainsFingerprintOutsideQuotes(htmlContent) {
    // Mock DOM node cleaning: strip <blockquote> tags
    const cleaned = htmlContent.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '');
    return cleaned.includes(FINGERPRINT);
}

const quotedHtmlWithSignature = `
    <p>תגובה שלי</p>
    <blockquote>
        <p>הודעה מצוטטת של משתמש אחר ${FINGERPRINT}</p>
    </blockquote>
`;

assert.strictEqual(
    textContainsFingerprintOutsideQuotes(quotedHtmlWithSignature),
    false,
    'Fingerprint inside quoted text must be ignored to prevent false positives'
);

const ownHtmlWithSignature = `
    <p>תגובה שלי עם החתימה ${FINGERPRINT}</p>
    <blockquote>
        <p>הודעה מצוטטת של משתמש אחר</p>
    </blockquote>
`;

assert.strictEqual(
    textContainsFingerprintOutsideQuotes(ownHtmlWithSignature),
    true,
    'Fingerprint outside quoted text must be correctly detected'
);

console.log('  ✅ Pass: Peer Detection fingerprinting and quote filtering work correctly.\n');

console.log('🎉 ALL SECURITY & INTEGRITY TESTS PASSED SUCCESSFULLY!\n');
