import { createHmac, timingSafeEqual } from 'node:crypto';

export function validLineSignature(body, signature, secret) {
  if (!Buffer.isBuffer(body) || typeof secret !== 'string' || !secret ||
      typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function requireLineSignature(secret) {
  return (req, res, next) => {
    if (!secret) return res.status(503).json({ error: 'Webhook is not configured' });
    if (!validLineSignature(req.body, req.headers['x-line-signature'], secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    next();
  };
}

export function requireAdminToken(token) {
  return (req, res, next) => {
    if (typeof token !== 'string' || token.length < 32) {
      return res.status(503).json({ error: 'Generation API is disabled' });
    }
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(req.headers.authorization || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

export function authorizedLineEvent(event, adminUsers) {
  return event?.type === 'message' && typeof event.source?.userId === 'string' &&
    adminUsers.includes(event.source.userId);
}

export function safeJobId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

export function publicClip(jobId, filename) {
  return safeJobId(jobId) && (filename === `${jobId}_final.mp4` || filename === `${jobId}_thumb.jpg`);
}
