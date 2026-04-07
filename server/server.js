/**
 * Smart ELCB Dashboard — Backend Server v2
 *
 * Serial (Arduino JSON) ──► WebSocket ──► Browser
 * HTTP static server for ../public/
 *
 * REST APIs:
 *   POST /api/reset    — send 'R' to Arduino
 *   GET  /api/ports    — list serial ports
 *   GET  /api/history  — last 120 readings
 *   GET  /api/stats    — min/max/avg for session
 *   GET  /api/faults   — fault log
 *   GET  /api/status   — latest snapshot
 *
 * ⚠️  Change SERIAL_PORT to your Arduino COM port before running
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const { SerialPort }     = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// ── Config ───────────────────────────────────────────────────────
const SERIAL_PORT   = process.env.SERIAL_PORT || 'COM5';
const BAUD_RATE     = 9600;
const HTTP_PORT     = process.env.PORT || 3000;
const HISTORY_MAX   = 300;
const FAULT_LOG_MAX = 50;

// ── Express + HTTP ────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── WebSocket ─────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ── In-memory stores ──────────────────────────────────────────────
const history  = [];   // { ts, voltage, current }
const faultLog = [];   // { ts, tripCurrent, duration }
let lastState  = { voltage: 0, current: 0, fault: false, tripCurrent: 0 };
let faultStart = null;
let sessionStart = Date.now();

function pushHistory(v, i) {
  history.push({ ts: Date.now(), voltage: v, current: i });
  if (history.length > HISTORY_MAX) history.shift();
}

function computeStats() {
  if (!history.length) return null;
  const vs = history.map(h => h.voltage);
  const cs = history.map(h => h.current);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    voltage: { avg: +avg(vs).toFixed(3), max: +Math.max(...vs).toFixed(3), min: +Math.min(...vs).toFixed(3) },
    current: { avg: +avg(cs).toFixed(3), max: +Math.max(...cs).toFixed(3), min: +Math.min(...cs).toFixed(3) },
    samples: history.length,
    faultCount: faultLog.length,
    sessionUptime: Math.floor((Date.now() - sessionStart) / 1000)
  };
}

// ── Serial ────────────────────────────────────────────────────────
let port = null, parser = null;

function connectSerial() {
  try {
    port   = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.on('open', () => {
      console.log(`✅  Serial connected: ${SERIAL_PORT} @ ${BAUD_RATE}`);
      broadcast({ type: 'serial_status', connected: true });
      broadcast({ type: 'hardware_reset' });
    });

    port.on('error', err => {
      console.error('❌  Serial error:', err.message);
      broadcast({ type: 'serial_status', connected: false, error: err.message });
    });

    port.on('close', () => {
      console.warn('⚠️   Serial closed — retry in 1.5s');
      broadcast({ type: 'serial_status', connected: false });
      setTimeout(connectSerial, 1500);
    });

    parser.on('data', raw => {
      const line = raw.trim();
      if (!line.startsWith('{')) return;
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'data' && !msg.fault) {
          lastState = { ...lastState, voltage: msg.voltage, current: msg.current, fault: false };
          pushHistory(msg.voltage, msg.current);
          if (faultStart) {
            const dur = Math.round((Date.now() - faultStart) / 1000);
            if (faultLog.length) faultLog[faultLog.length - 1].duration = dur;
            faultStart = null;
          }
        }

        if (msg.type === 'fault') {
          lastState = { ...lastState, fault: true, tripCurrent: msg.tripCurrent };
          faultStart = Date.now();
          faultLog.push({ ts: Date.now(), tripCurrent: msg.tripCurrent, duration: null });
          if (faultLog.length > FAULT_LOG_MAX) faultLog.shift();
        }

        if (msg.type === 'reset' || msg.type === 'boot') {
          lastState.fault = false;
          if (faultStart) {
            const dur = Math.round((Date.now() - faultStart) / 1000);
            if (faultLog.length) faultLog[faultLog.length - 1].duration = dur;
            faultStart = null;
          }
        }

        broadcast(msg);
      } catch (_) {}
    });

  } catch (err) {
    console.error('❌  Cannot open port:', err.message, '— retry in 5s');
    setTimeout(connectSerial, 5000);
  }
}

// ── REST endpoints ────────────────────────────────────────────────
app.post('/api/reset', (req, res) => {
  if (!port?.isOpen) return res.status(503).json({ ok: false, error: 'Serial not connected' });
  port.write('R', err => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    console.log('🔄  Reset command sent');
    res.json({ ok: true });
  });
});

app.get('/api/ports',   async (_, res) => res.json(await SerialPort.list()));
app.get('/api/history', (_, res) => res.json(history.slice(-120)));
app.get('/api/stats',   (_, res) => res.json(computeStats() || {}));
app.get('/api/faults',  (_, res) => res.json([...faultLog].reverse()));
app.get('/api/status',  (_, res) => res.json({
  ...lastState,
  serialConnected: port?.isOpen || false,
  uptime: Math.floor((Date.now() - sessionStart) / 1000)
}));

// ── WebSocket — send snapshot on new connection ───────────────────
wss.on('connection', ws => {
  console.log('🌐  Browser connected');
  ws.send(JSON.stringify({
    type: 'snapshot',
    state: lastState,
    stats: computeStats(),
    faults: faultLog.slice(-10)
  }));
  ws.on('message', msg => {
    if (msg.toString().trim() === 'RESET' && port?.isOpen) port.write('R');
  });
  ws.on('close', () => console.log('🌐  Browser disconnected'));
});

// ── Boot ──────────────────────────────────────────────────────────
server.listen(HTTP_PORT, () => {
  console.log(`\n⚡  Smart ELCB Dashboard`);
  console.log(`🚀  http://localhost:${HTTP_PORT}`);
  console.log(`🔌  Serial port: ${SERIAL_PORT}\n`);
  connectSerial();
});
