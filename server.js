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
const tokens = new Map(); // token -> { username, expiresAt }

function requireAuth(req, res, next) {
  if (!AUTH_PASSWORD) return next();
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
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
  next();
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Health check (no auth)
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'rosterapp-api', authRequired: !!AUTH_PASSWORD });
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
  const token = crypto.randomBytes(32).toString('hex');
  const name = (username && String(username).trim()) ? String(username).trim().slice(0, 64) : 'Anonymous';
  tokens.set(token, { username: name, expiresAt: Date.now() + TOKEN_TTL_MS });
  res.json({ token, expiresIn: TOKEN_TTL_MS });
});

// GET /api/state — return current state or 404 if none (auth required if AUTH_PASSWORD set)
app.get('/api/state', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return res.status(404).json({ error: 'No state yet' });
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return res.status(404).json({ error: 'No state yet' });
    }
    res.json(data);
  } catch (err) {
    console.warn('GET /api/state error:', err.message);
    res.status(404).json({ error: 'No state yet' });
  }
});

// PUT /api/state — overwrite state with body (auth required if AUTH_PASSWORD set)
app.put('/api/state', requireAuth, (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (!Array.isArray(data.rosterTabs)) {
      return res.status(400).json({ error: 'Missing or invalid rosterTabs' });
    }
    if (req.authUser) {
      data.lastModifiedBy = req.authUser;
      data.lastModifiedAt = Date.now();
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
    res.json({ ok: true, ts: Date.now() });
  } catch (err) {
    console.error('PUT /api/state error:', err);
    res.status(500).json({ error: 'Failed to save state' });
  }
});

app.listen(PORT, () => {
  console.log(`Roster API listening on http://localhost:${PORT}`);
  if (AUTH_PASSWORD) console.log('Login is required (AUTH_PASSWORD set).');
});
