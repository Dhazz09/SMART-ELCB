/**
 * Smart ELCB Dashboard — Backend Server
 * 
 * Bridges Arduino Serial (JSON lines) → WebSocket → Browser
 * Also serves the static frontend from ../public/
 * 
 * Serial port: auto-detects Arduino on startup (edit SERIAL_PORT if needed)
 * WebSocket:   ws://localhost:3000
 * HTTP:        http://localhost:3000
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// ── Configuration ────────────────────────────────────────────────
// ⚠️  Change SERIAL_PORT to match your Arduino's COM port / tty path
//    Windows:  'COM3', 'COM4', etc.
//    macOS:    '/dev/cu.usbmodem...' 
//    Linux:    '/dev/ttyUSB0', '/dev/ttyACM0'
const SERIAL_PORT = process.env.SERIAL_PORT || 'COM5';
const BAUD_RATE   = 9600;
const HTTP_PORT   = 3000;

// ── Express + HTTP ───────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── WebSocket Server ─────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ── Serial Port ──────────────────────────────────────────────────
let port   = null;
let parser = null;

function connectSerial() {
  try {
    port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.on('open', () => {
      console.log(`✅  Serial connected: ${SERIAL_PORT} @ ${BAUD_RATE}`);
      broadcast({ type: 'serial_status', connected: true });
      // Always broadcast hardware_reset on reconnect so browser clears any active fault alarm
      broadcast({ type: 'hardware_reset' });
    });

    port.on('error', err => {
      console.error('❌  Serial error:', err.message);
      broadcast({ type: 'serial_status', connected: false, error: err.message });
    });

    port.on('close', () => {
      console.warn('⚠️   Serial port closed. Retrying in 1.5s...');
      broadcast({ type: 'serial_status', connected: false });
      // Retry quickly — Arduino physical reset reboots in ~1-2s
      setTimeout(connectSerial, 1500);
    });

    parser.on('data', line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;   // Ignore non-JSON lines
      try {
        const parsed = JSON.parse(trimmed);
        broadcast(parsed);                     // Forward to all WebSocket clients
      } catch (_) {
        // Ignore parse errors
      }
    });

  } catch (err) {
    console.error('❌  Cannot open serial port:', err.message);
    console.log('   Retrying in 5s...');
    setTimeout(connectSerial, 5000);
  }
}

// ── REST API ─────────────────────────────────────────────────────
// POST /api/reset  →  sends 'R' to Arduino
app.post('/api/reset', (req, res) => {
  if (!port || !port.isOpen) {
    return res.status(503).json({ ok: false, error: 'Serial not connected' });
  }
  port.write('R', err => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    console.log('🔄  Reset command sent to Arduino');
    res.json({ ok: true });
  });
});

// GET /api/ports  →  list available serial ports (helper for setup)
app.get('/api/ports', async (req, res) => {
  const ports = await SerialPort.list();
  res.json(ports);
});

// ── WebSocket client message handling ─────────────────────────────
wss.on('connection', ws => {
  console.log('🌐  Browser connected');
  ws.on('message', msg => {
    const text = msg.toString().trim();
    if (text === 'RESET' && port && port.isOpen) {
      port.write('R');
    }
  });
  ws.on('close', () => console.log('🌐  Browser disconnected'));
});

// ── Start ─────────────────────────────────────────────────────────
server.listen(HTTP_PORT, () => {
  console.log(`🚀  Dashboard: http://localhost:${HTTP_PORT}`);
  console.log(`🔌  Connecting to serial port ${SERIAL_PORT}...`);
  connectSerial();
});
