const test = require('node:test');
const assert = require('node:assert');
const { classifyIntent, analyzeSentiment, evaluateEscalation } = require('../src/classifier');

test('Classifier: identifies billing inquiry intent with high confidence', () => {
    const text = 'I noticed an unexpected charge on my monthly subscription credit card invoice';
    const result = classifyIntent(text);
    assert.strictEqual(result.intent, 'billing');
    assert.ok(result.confidence >= 0.60);
});

test('Classifier: identifies technical error stacktrace intent', () => {
    const text = 'The web app keeps giving a 500 error code and crashes during checkout';
    const result = classifyIntent(text);
    assert.strictEqual(result.intent, 'technical_issue');
    assert.ok(result.confidence >= 0.60);
});

test('Classifier: identifies account access and password resets', () => {
    const text = 'I am locked out of my account and my 2fa authenticator code is not working';
    const result = classifyIntent(text);
    assert.strictEqual(result.intent, 'account_access');
    assert.ok(result.confidence >= 0.60);
});

test('Sentiment: scores polarity accurately', () => {
    const pos = analyzeSentiment('Thank you so much, your help was wonderful and great');
    assert.ok(pos > 0.3);

    const neg = analyzeSentiment('This product is terrible, awful and completely broken');
    assert.ok(neg < -0.3);
});

test('Escalation: triggers on critical legal keyword', () => {
    const fullText = 'I will contact my lawyer regarding this fraudulent charge';
    const intentRes = classifyIntent(fullText);
    const sentiment = analyzeSentiment(fullText);
    const esc = evaluateEscalation(fullText, intentRes.intent, intentRes.confidence, sentiment);

    assert.strictEqual(esc.escalate, true);
    assert.strictEqual(esc.priority, 'urgent');
});

test('Escalation: allows autonomous resolution for standard inquiries', () => {
    const fullText = 'Can you send me a receipt for my previous subscription invoice?';
    const intentRes = classifyIntent(fullText);
    const sentiment = analyzeSentiment(fullText);
    const esc = evaluateEscalation(fullText, intentRes.intent, intentRes.confidence, sentiment);

    assert.strictEqual(esc.escalate, false);
    assert.strictEqual(esc.priority, 'low');
});
