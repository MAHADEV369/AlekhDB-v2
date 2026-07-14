// alekhdb-privacy.js — Elective: PII/secret redaction before storage
// No new deps — regex-based with optional LLM enhancement

const DEFAULT_PATTERNS = {
  openai_key: /sk-[a-zA-Z0-9]{20,}/g,
  anthropic_key: /sk-ant-[a-zA-Z0-9]{20,}/g,
  generic_api_key: /(?:api[_-]?key|apikey|secret)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
  aws_access: /AKIA[0-9A-Z]{16}/g,
  aws_secret: /aws_secret_access_key\s*[:=]\s*['"]?([a-zA-Z0-9/+=]{40})['"]?/gi,
  jwt: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
  credit_card: /\b(?:\d[ -]*?){13,16}\b/g,
  private_ip: /\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
};

const REPLACEMENT_LABELS = {
  openai_key: '[REDACTED_OPENAI_KEY]', anthropic_key: '[REDACTED_ANTHROPIC_KEY]', generic_api_key: '[REDACTED_API_KEY]',
  aws_access: '[REDACTED_AWS_ACCESS_KEY]', aws_secret: '[REDACTED_AWS_SECRET]', jwt: '[REDACTED_JWT]',
  email: '[REDACTED_EMAIL]', phone: '[REDACTED_PHONE]', credit_card: '[REDACTED_CREDIT_CARD]', private_ip: '[REDACTED_IP]', ssn: '[REDACTED_SSN]',
};

export async function enablePrivacy(db, config = {}) {
  const { patterns = {}, disablePatterns = [], customPatterns = {}, audit = true } = config;
  const activePatterns = { ...DEFAULT_PATTERNS, ...patterns, ...customPatterns };
  disablePatterns.forEach(p => delete activePatterns[p]);

  const originalAddMemory = db.addMemory.bind(db);
  db.addMemory = async function(text, scope = db.currentScope || "work", options = {}) {
    const { original, redactions } = redactText(text, activePatterns);
    if (audit && redactions.length > 0) {
      redactions.forEach(r => db.logAudit('PII_REDACTED', `Pattern ${r.pattern} matched. Replaced ${r.count} occurrence(s).`));
      db._privacyAuditLog = (db._privacyAuditLog || []).concat(redactions.map(r => ({ timestamp: new Date().toISOString(), pattern: r.pattern, count: r.count, fingerprint: r.firstMatch?.slice(0, 3) + '***', replacedWith: r.replacement })));
    }
    return originalAddMemory(original, scope, options);
  };

  const originalAddNode = db.addNode.bind(db);
  db.addNode = function(id, label, type, properties = {}, scope = db.currentScope || "work", options = {}) {
    if (typeof label === 'string') { const { original } = redactText(label, activePatterns); label = original; }
    if (properties && typeof properties === 'object') properties = redactProperties(properties, activePatterns);
    return originalAddNode(id, label, type, properties, scope, options);
  };

  db.getPrivacyLog = () => db._privacyAuditLog || [];
  db.clearPrivacyLog = () => { db._privacyAuditLog = []; };
  db.disablePrivacy = () => { db.addMemory = originalAddMemory; db.addNode = originalAddNode; delete db.getPrivacyLog; delete db.clearPrivacyLog; delete db.disablePrivacy; delete db._privacyAuditLog; };
  db.emit('privacy:enabled', { patterns: Object.keys(activePatterns) });
}

function redactText(text, patterns) {
  let result = text;
  const redactions = [];
  for (const [name, pattern] of Object.entries(patterns)) {
    const matches = text.match(pattern);
    if (matches) {
      const replacement = REPLACEMENT_LABELS[name] || `[REDACTED_${name.toUpperCase()}]`;
      result = result.replace(pattern, replacement);
      redactions.push({ pattern: name, count: matches.length, firstMatch: matches[0], replacement });
    }
  }
  return { original: result, redactions };
}

function redactProperties(props, patterns) {
  const result = { ...props };
  for (const [key, value] of Object.entries(result)) { if (typeof value === 'string') result[key] = redactText(value, patterns).original; }
  return result;
}
