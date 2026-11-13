/**
 * SupportPilot AI Natural Language Intent Classifier & Sentiment Analyzer
 */

const INTENT_DICTIONARIES = {
    billing: {
        keywords: ['invoice', 'charge', 'billing', 'credit card', 'refund', 'subscription', 'payment', 'receipt', 'overcharged', 'pricing', 'cost', 'fee', 'renew'],
        weight: 1.2
    },
    technical_issue: {
        keywords: ['error', 'bug', 'crash', 'timeout', '500', '404', 'broken', 'failure', 'glitch', 'down', 'latency', 'slow', 'disconnect', 'exception', 'stacktrace'],
        weight: 1.3
    },
    account_access: {
        keywords: ['login', 'password', 'mfa', '2fa', 'authenticator', 'locked', 'reset', 'credentials', 'email', 'sso', 'unauthorized', 'permission', 'access'],
        weight: 1.25
    },
    cancellation: {
        keywords: ['cancel', 'terminate', 'close account', 'stop subscription', 'downgrade', 'quit', 'delete account'],
        weight: 1.4
    },
    feature_request: {
        keywords: ['feature', 'request', 'suggest', 'improve', 'enhancement', 'would be nice', 'can you add', 'integration', 'roadmap'],
        weight: 1.1
    }
};

const SENTIMENT_LEXICON = {
    positive: ['great', 'excellent', 'helpful', 'thanks', 'appreciate', 'good', 'wonderful', 'fast', 'love', 'perfect'],
    negative: ['terrible', 'awful', 'frustrated', 'horrible', 'unacceptable', 'worst', 'angry', 'hate', 'useless', 'disaster', 'scam', 'fraud', 'lawyer', 'chargeback']
};

const HIGH_RISK_TRIGGERS = [
    'lawyer', 'legal action', 'sue', 'fraud', 'chargeback', 'unacceptable', 
    'breach', 'stolen', 'escalate to manager', 'supervisor'
];

function tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1);
}

function classifyIntent(text) {
    const tokens = tokenize(text);
    if (tokens.length === 0) {
        return { intent: 'technical_issue', confidence: 0.5 };
    }

    const textLower = text.toLowerCase();
    const scores = {};

    for (const [intent, config] of Object.entries(INTENT_DICTIONARIES)) {
        let score = 0;
        for (const kw of config.keywords) {
            if (kw.includes(' ')) {
                if (textLower.includes(kw)) {
                    score += 2.5 * config.weight;
                }
            } else {
                const count = tokens.filter(t => t === kw).length;
                if (count > 0) {
                    score += (count * 1.5) * config.weight;
                }
            }
        }
        scores[intent] = score;
    }

    let topIntent = 'technical_issue';
    let maxScore = -1;
    let totalScore = 0;

    for (const [intent, sc] of Object.entries(scores)) {
        totalScore += sc;
        if (sc > maxScore) {
            maxScore = sc;
            topIntent = intent;
        }
    }

    const confidence = totalScore > 0 
        ? Math.min(0.98, Math.max(0.40, Number((maxScore / totalScore).toFixed(2))))
        : 0.45;

    return {
        intent: topIntent,
        confidence: confidence
    };
}

function analyzeSentiment(text) {
    const tokens = tokenize(text);
    if (tokens.length === 0) return 0.0;

    let score = 0;
    for (const t of tokens) {
        if (SENTIMENT_LEXICON.positive.includes(t)) score += 1;
        if (SENTIMENT_LEXICON.negative.includes(t)) score -= 1.5;
    }

    const normalized = Math.max(-1.0, Math.min(1.0, score / Math.max(1, tokens.length * 0.4)));
    return Number(normalized.toFixed(2));
}

function evaluateEscalation(text, intent, confidence, sentiment) {
    const textLower = text.toLowerCase();

    // Check high risk legal / critical keywords
    for (const trigger of HIGH_RISK_TRIGGERS) {
        if (textLower.includes(trigger)) {
            return {
                escalate: true,
                reason: `High-risk trigger keyword detected: "${trigger}"`,
                priority: 'urgent'
            };
        }
    }

    // Check sentiment threshold
    if (sentiment < -0.35) {
        return {
            escalate: true,
            reason: `Negative customer sentiment detected (${sentiment})`,
            priority: 'high'
        };
    }

    // Check classification confidence
    if (confidence < 0.60) {
        return {
            escalate: true,
            reason: `Low classification confidence (${(confidence * 100).toFixed(0)}%) requires human review`,
            priority: 'medium'
        };
    }

    return {
        escalate: false,
        reason: 'Autonomous tier-1 AI resolution suitable',
        priority: 'low'
    };
}

function generateAiResponse(intent, customerName) {
    const responses = {
        billing: `Hi ${customerName}, I've reviewed your billing inquiry. Our records show your account statement has been processed. If you notice a duplicate charge, our automated refund protocol will credit it within 3-5 business days. Would you like a copy of your recent receipt?`,
        technical_issue: `Hi ${customerName}, thank you for reaching out regarding this technical issue. I have scanned our system status telemetry and all core services are operational. Please try flushing your local cache or testing in an incognito window. Let me know if the error persists.`,
        account_access: `Hi ${customerName}, I can assist with resetting your access. We have dispatched a verification email to your registered address. Please follow the instructions to secure your login credentials.`,
        cancellation: `Hi ${customerName}, we are sorry to hear you are considering cancellation. Your account is scheduled to remain active until the end of your billing cycle. Please confirm if you would like me to finalize this cancellation.`,
        feature_request: `Hi ${customerName}, thank you for suggesting this improvement! I have logged this feature request with our platform engineering team for review in our upcoming release cycle.`
    };
    return responses[intent] || `Hi ${customerName}, thank you for your message. How can I assist you further?`;
}

module.exports = {
    classifyIntent,
    analyzeSentiment,
    evaluateEscalation,
    generateAiResponse
};
