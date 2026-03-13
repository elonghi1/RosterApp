const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;
const STATE_FILE = process.env.STATE_FILE_PATH || path.join(__dirname, 'state.json');

// Optional: if set, GET/PUT /api/state require login. Set AUTH_PASSWORD to a strong password.
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOKEN_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const tokens = new Map(); // token -> { username, issuedAt, expiresAt }

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of tokens.entries()) {
    if (!entry || now > entry.expiresAt) {
      tokens.delete(token);
    }
  }
}

setInterval(cleanupExpiredTokens, TOKEN_SWEEP_INTERVAL_MS).unref();

function getBearerToken(req) {
  const auth = req.headers.authorization;
  return auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function requireAuth(req, res, next) {
  if (!AUTH_PASSWORD) return next();

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Login required', code: 'unauthorized' });
  }

  const entry = tokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) tokens.delete(token);
    return res.status(401).json({ error: 'Session expired or invalid', code: 'unauthorized' });
  }

  req.authToken = token;
  req.authUser = entry.username || 'Anonymous';
  req.authSession = entry;
  next();
}

function validateStatePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Invalid JSON body';
  }
  if (!Array.isArray(data.rosterTabs)) {
    return 'Missing or invalid rosterTabs';
  }
  if (data.rosterTabs.length > 250) {
    return 'rosterTabs exceeds maximum allowed size';
  }

  for (let i = 0; i < data.rosterTabs.length; i += 1) {
    const tab = data.rosterTabs[i];
    if (!tab || typeof tab !== 'object' || Array.isArray(tab)) {
      return `rosterTabs[${i}] must be an object`;
    }
    if (typeof tab.name !== 'string' || !tab.name.trim()) {
      return `rosterTabs[${i}].name must be a non-empty string`;
    }
  }

  return null;
}

function summarizeState(data) {
  if (!data || !Array.isArray(data.rosterTabs)) {
    return { rosterCount: 0, staffCount: 0, shiftCount: 0 };
  }

  let staffCount = 0;
  let shiftCount = 0;

  for (const tab of data.rosterTabs) {
    const members = Array.isArray(tab?.staff) ? tab.staff : [];
    staffCount += members.length;

    for (const member of members) {
      const weekShifts = member?.weekShifts && typeof member.weekShifts === 'object'
        ? member.weekShifts
        : {};
      for (const shifts of Object.values(weekShifts)) {
        if (Array.isArray(shifts)) {
          shiftCount += shifts.filter((s) => s && typeof s === 'object' && (s.start || s.end || s.type)).length;
        }
      }
    }
  }

  return { rosterCount: data.rosterTabs.length, staffCount, shiftCount };
}

function computeStateRevision(data) {
  const payload = data && typeof data === 'object' ? data : {};
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') return null;
  return data;
}

function writeStateAtomic(data) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });

  const tmpFile = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, STATE_FILE);
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Health check (no auth)
app.get('/', (req, res) => {
  cleanupExpiredTokens();
  res.json({
    ok: true,
    service: 'rosterapp-api',
    authRequired: !!AUTH_PASSWORD,
    activeSessions: AUTH_PASSWORD ? tokens.size : 0,
  });
});

// POST /api/login — body: { username, password }. Username is for "who changed" in cloud sync only.
app.post('/api/login', (req, res) => {
  if (!AUTH_PASSWORD) {
    return res.status(200).json({ token: 'no-auth', message: 'Auth not configured' });
  }

  const { username, password } = req.body || {};
  if (!password || password !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password', code: 'invalid_password' });
  }

  cleanupExpiredTokens();

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const name = (username && String(username).trim()) ? String(username).trim().slice(0, 64) : 'Anonymous';
  tokens.set(token, { username: name, issuedAt: now, expiresAt: now + TOKEN_TTL_MS });

  res.json({ token, expiresIn: TOKEN_TTL_MS });
});

// POST /api/logout — invalidate caller token (no-op when auth is disabled)
app.post('/api/logout', requireAuth, (req, res) => {
  if (!AUTH_PASSWORD) {
    return res.json({ ok: true, message: 'Auth not configured' });
  }

  tokens.delete(req.authToken);
  return res.json({ ok: true });
});

// GET /api/session — validate current token and return lightweight session details
app.get('/api/session', requireAuth, (req, res) => {
  if (!AUTH_PASSWORD) {
    return res.json({ ok: true, authRequired: false });
  }

  const { username, issuedAt, expiresAt } = req.authSession;
  res.json({ ok: true, authRequired: true, username, issuedAt, expiresAt });
});

// GET /api/state — return current state or 404 if none (auth required if AUTH_PASSWORD set)
app.get('/api/state', requireAuth, (req, res) => {
  try {
    const data = readState();
    if (!data) {
      return res.status(404).json({ error: 'No state yet' });
    }
    const revision = computeStateRevision(data);
    res.set('ETag', `"${revision}"`);
    res.json({ ...data, stateRevision: revision });
  } catch (err) {
    console.warn('GET /api/state error:', err.message);
    res.status(404).json({ error: 'No state yet' });
  }
});

// GET /api/state/meta — lightweight metadata for sync checks
app.get('/api/state/meta', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return res.status(404).json({ error: 'No state yet' });
    }

    const stat = fs.statSync(STATE_FILE);
    const data = readState() || {};
    return res.json({
      exists: true,
      bytes: stat.size,
      updatedAt: stat.mtimeMs,
      lastModifiedBy: data.lastModifiedBy || null,
      lastModifiedAt: data.lastModifiedAt || null,
      stateRevision: computeStateRevision(data),
    });
  } catch (err) {
    console.warn('GET /api/state/meta error:', err.message);
    return res.status(404).json({ error: 'No state yet' });
  }
});

// PUT /api/state — overwrite state with body (auth required if AUTH_PASSWORD set)
app.put('/api/state', requireAuth, (req, res) => {
  try {
    const data = req.body;
    const validationError = validateStatePayload(data);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const currentState = readState();
    const currentSummary = summarizeState(currentState);
    const currentRevision = currentState ? computeStateRevision(currentState) : null;
    const expectedRevisionHeader = String(req.headers['x-state-revision'] || '').trim();

    if (currentState && expectedRevisionHeader && currentRevision !== expectedRevisionHeader) {
      return res.status(409).json({
        error: 'Cloud state changed since your last sync',
        code: 'state_revision_conflict',
        currentSummary,
        currentRevision,
      });
    }

    if (req.authUser) {
      data.lastModifiedBy = req.authUser;
      data.lastModifiedAt = Date.now();
    }

    // Guard against accidental wipes when a stale/new device pushes an empty dataset.
    const incomingSummary = summarizeState(data);
    const isIncomingPossiblyEmpty = incomingSummary.staffCount === 0 && incomingSummary.shiftCount === 0;
    const hasExistingData = currentSummary.staffCount > 0 || currentSummary.shiftCount > 0;
    const forceOverwrite = String(req.headers['x-force-overwrite'] || '').toLowerCase() === 'true';

    if (hasExistingData && isIncomingPossiblyEmpty && !forceOverwrite) {
      return res.status(409).json({
        error: 'Refusing to overwrite non-empty cloud state with an empty payload',
        code: 'destructive_write_blocked',
        currentSummary,
        incomingSummary,
      });
    }

    writeStateAtomic(data);
    const newRevision = computeStateRevision(data);
    return res.json({ ok: true, ts: Date.now(), stateRevision: newRevision });
  } catch (err) {
    console.error('PUT /api/state error:', err);
    return res.status(500).json({ error: 'Failed to save state' });
  }
});

app.listen(PORT, () => {
  console.log(`Roster API listening on http://localhost:${PORT}`);
  if (AUTH_PASSWORD) console.log('Login is required (AUTH_PASSWORD set).');
});
