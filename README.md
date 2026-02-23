# SMART-ELCB
# ⚡ Smart ELCB — Earth Leakage Circuit Breaker Prototype

> A smart, Arduino-based Earth Leakage Circuit Breaker (ELCB) with real-time monitoring, a live web dashboard, fault detection, and remote reset capability.

![Arduino](https://img.shields.io/badge/Arduino-Uno-00979D?style=for-the-badge&logo=arduino&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?style=for-the-badge&logo=node.js&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-Live%20Data-010101?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## 📌 Project Overview

The Smart ELCB is a prototype safety device that monitors electrical circuits for earth leakage faults. When a fault is detected, it immediately trips the relay to cut power to the load — just like a real-world circuit breaker. What makes this prototype *smart* is the addition of a live web dashboard that displays real-time voltage and current readings, triggers a visual and audio alarm on fault detection, logs all events with timestamps, and allows remote system reset.

This project was built as a learning prototype combining embedded systems, real-time serial communication, WebSocket networking, and modern web frontend design.

---

## ✨ Features

- **Real-time monitoring** — Live battery voltage and load current displayed on both the onboard LCD and the web dashboard
- **Earth leakage simulation** — A push button on Pin 2 simulates an earth leakage event
- **Instant trip action** — Relay cuts power immediately upon fault detection
- **Web dashboard** — Industrial-style dark UI with live charts, LCD replica, and event log
- **Drip alarm** — Visual flashing banner and audio alarm triggered on fault, with trip time and trip current recorded
- **Remote reset** — Reset button on the dashboard sends a serial command to the Arduino to restore normal operation
- **Event log** — Every fault, reset, and status change is timestamped and logged in the browser
- **GitHub integration** — Editable repository link box built into the dashboard

---

## 🔧 Hardware Components

| Component | Details |
|---|---|
| Microcontroller | Arduino Uno |
| Current Sensor | ACS712-05B (5A model) — connected to A0, sensitivity 185 mV/A |
| Relay Module | 5V Active-Low relay on Pin 7, wired to Normally Open (NO) terminal |
| Display | 16×2 LCD via I2C (address 0x27) |
| Fault Trigger | Push button on Pin 2 with `INPUT_PULLUP` (simulates earth leakage) |
| Voltage Monitoring | Voltage divider: R1 = 12kΩ, R2 = 4.7kΩ, output to A1 (multiplier: 3.553) |

---

## 🗂️ Project Structure

```
Smart-ELCB/
├── arduino/
│   └── smart_elcb.ino        ← Arduino sketch (upload via Arduino IDE)
├── server/
│   ├── package.json          ← Node.js dependencies
│   └── server.js             ← Express + WebSocket server (Serial bridge)
├── public/
│   └── index.html            ← Web dashboard (served automatically)
└── SETUP_GUIDE.md            ← Full VS Code setup and tutorial
```

---

## ⚙️ How It Works

### 1. Initialisation
On power-up, the Arduino holds the relay OFF for 2 seconds and averages 500 ADC samples from the ACS712 to calibrate the zero-current voltage (`Vzero`). This eliminates offset drift before the system goes live.

### 2. Normal Operation
Once calibrated, the relay energises (Active-Low: `LOW` = ON), powering the 12V LED load. The LCD displays live battery voltage and current draw. Every 500 ms, a JSON packet is sent over Serial to the Node.js server, which broadcasts it via WebSocket to the browser dashboard.

### 3. Fault Detection
When the push button on Pin 2 is pressed (simulating earth leakage), the Arduino:
- Records the trip current at the moment of fault
- Immediately drives the relay `HIGH` (OFF), cutting load power
- Displays `EARTH LEAKAGE!` and the trip current on the LCD
- Sends a fault JSON event over Serial

### 4. Dashboard Response
The web dashboard receives the fault event and:
- Flashes the alarm banner red
- Sounds an alternating audio alarm
- Logs the fault time and trip current
- Marks the fault point on the live charts
- Enables the Reset button

### 5. Reset Flow
Clicking **Reset** on the dashboard sends a `POST /api/reset` request to the Node.js server, which writes the character `'R'` over Serial to the Arduino. The Arduino then re-calibrates and re-energises the relay, and the dashboard returns to normal state.

```
Browser → POST /api/reset → Node.js → Serial 'R' → Arduino → Relay ON → JSON reset event → WebSocket → Browser
```

---

## 🚀 Getting Started

### Prerequisites
- [Arduino IDE](https://www.arduino.cc/en/software)
- [Node.js v18 LTS or newer](https://nodejs.org)
- [VS Code](https://code.visualstudio.com) (recommended)
- Library: **LiquidCrystal I2C** by Frank de Brabander (install via Arduino IDE Library Manager)

### Step 1 — Upload the Arduino Sketch
1. Open `arduino/smart_elcb.ino` in Arduino IDE
2. Install the `LiquidCrystal I2C` library if not already installed
3. Select **Board: Arduino Uno** and your correct COM port
4. Click **Upload**
5. Open Serial Monitor (baud: 9600) to verify JSON output, then **close it**

### Step 2 — Configure the Serial Port
Open `server/server.js` and edit line 17:
```js
const SERIAL_PORT = process.env.SERIAL_PORT || 'COM3'; // ← change to your port
```

| OS | Example |
|---|---|
| Windows | `'COM3'` |
| macOS | `'/dev/cu.usbmodem14101'` |
| Linux | `'/dev/ttyACM0'` |

### Step 3 — Start the Server
```bash
cd server
npm install
node server.js
```

### Step 4 — Open the Dashboard
Navigate to **http://localhost:3000** in your browser.

> For full details, troubleshooting, and the serial protocol reference, see [`SETUP_GUIDE.md`](./SETUP_GUIDE.md).

---

## 📡 Serial JSON Protocol

| Message Type | Direction | Key Fields |
|---|---|---|
| `boot` | Arduino → Browser | `status` |
| `data` | Arduino → Browser | `voltage`, `current`, `fault`, `tripCurrent`, `tripTime` |
| `fault` | Arduino → Browser | `tripCurrent`, `tripTime` |
| `reset` | Arduino → Browser | `status` |
| `serial_status` | Server → Browser | `connected`, `error` |
| `'R'` (raw char) | Browser → Arduino | Reset command |

---

## 📊 Operational Logic

```
Power ON
   │
   ▼
Calibrate Vzero (2s, 500 samples)
   │
   ▼
Relay ON → Load Powered
   │
   ├──── Every 500ms: Read Voltage & Current → LCD + Serial JSON
   │
   └──── Fault Button Pressed?
              │ YES
              ▼
         Record tripCurrent
         Relay OFF (load disconnected)
         LCD: "EARTH LEAKAGE!"
         Serial: fault event
         Dashboard: alarm + log
              │
              └──── Serial 'R' received?
                         │ YES
                         ▼
                    Re-calibrate → Relay ON → Normal
```

---

## 🔮 Future Improvements

- Replace push button with a real CT-based differential current sensing circuit for genuine earth leakage detection
- Add Wi-Fi capability using ESP8266/ESP32 to eliminate the need for a USB serial connection
- Store fault history in EEPROM so it survives power cycles
- Add SMS/email alert integration for remote notification
- Implement MQTT protocol for IoT dashboard integration
- Add a current threshold setting on the dashboard to configure the trip sensitivity

---

## 📷 Circuit Diagram

<img width="8192" height="4022" alt="Arduino Power Management-2026-02-23-162112" src="https://github.com/user-attachments/assets/957d4408-418b-424d-989a-0b52db54dc54" />

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

## 🙋 Author

**Dhazz09**  
GitHub: [@Dhazz09](https://github.com/Dhazz09)

---

> Built as an embedded systems learning project combining Arduino hardware, Node.js backend, and a live web dashboard. Contributions and suggestions are welcome!
