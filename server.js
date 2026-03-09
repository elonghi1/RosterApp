const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;
const STATE_FILE = path.join(__dirname, 'state.json');

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'rosterapp-api' });
});

// GET /api/state — return current state or 404 if none
app.get('/api/state', (req, res) => {
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

// PUT /api/state — overwrite state with body
app.put('/api/state', (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (!Array.isArray(data.rosterTabs)) {
      return res.status(400).json({ error: 'Missing or invalid rosterTabs' });
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
});
