/* * Smart Earth Leakage Circuit Breaker (ELCB)
 * Arduino Uno - with Serial JSON output for Web Dashboard
 * * Connections:
 * - ACS712-05B -> A0 (185mV/A)
 * - Relay (Active-Low, NO) -> Pin 7
 * - 16x2 LCD I2C (0x27) -> SDA/SCL
 * - Fault Button -> Pin 2 (INPUT_PULLUP)
 * - Voltage Divider (12k / 4.7k) -> A1
 * - Reset Command from Serial -> 'R' character
 */

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ... rest of your variables and setup() code here ...

// ── Pin Definitions ──────────────────────────────────────────────
#define RELAY_PIN       7
#define FAULT_BTN_PIN   2
#define CURRENT_PIN     A0
#define VOLTAGE_PIN     A1

// ── Constants ────────────────────────────────────────────────────
#define RELAY_ON        LOW
#define RELAY_OFF       HIGH
#define SAMPLES         200
#define VOLTAGE_MULT    3.553f
#define ACS_SENSITIVITY 0.185f   // V per Amp (185 mV/A)
#define AREF_VOLTAGE    5.0f
#define ADC_RESOLUTION  1024.0f
#define SERIAL_INTERVAL 500       // ms between JSON sends

// ── LCD ──────────────────────────────────────────────────────────
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ── State ─────────────────────────────────────────────────────────
float   vzero        = 2.5f;
bool    faultState   = false;
float   tripCurrent  = 0.0f;
unsigned long tripTime = 0;
unsigned long lastSerial = 0;

// ── Setup ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(FAULT_BTN_PIN, INPUT_PULLUP);
  digitalWrite(RELAY_PIN, RELAY_OFF);   // fail-safe OFF on boot

  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print(" Smart ELCB v1.0");
  lcd.setCursor(0, 1); lcd.print("  Calibrating...");

  // 2-second zero calibration
  long sum = 0;
  for (int i = 0; i < 500; i++) { sum += analogRead(CURRENT_PIN); delay(2); }
  vzero = (sum / 500.0f) * (AREF_VOLTAGE / ADC_RESOLUTION);

  delay(500);
  lcd.clear();
  digitalWrite(RELAY_PIN, RELAY_ON);   // Energise load

  // Send handshake
  Serial.println("{\"type\":\"boot\",\"status\":\"ready\"}");
}

// ── Helpers ───────────────────────────────────────────────────────
float readCurrent() {
  long sum = 0;
  for (int i = 0; i < SAMPLES; i++) sum += analogRead(CURRENT_PIN);
  float avgVoltage = (sum / (float)SAMPLES) * (AREF_VOLTAGE / ADC_RESOLUTION);
  float current = (avgVoltage - vzero) / ACS_SENSITIVITY;
  return abs(current);
}

float readVoltage() {
  long sum = 0;
  for (int i = 0; i < 50; i++) { sum += analogRead(VOLTAGE_PIN); delay(1); }
  float avgADC = sum / 50.0f;
  return (avgADC * (AREF_VOLTAGE / ADC_RESOLUTION)) * VOLTAGE_MULT;
}

void updateLCD(float voltage, float current) {
  lcd.setCursor(0, 0);
  lcd.print("V:"); lcd.print(voltage, 2); lcd.print("V   ");
  lcd.setCursor(0, 1);
  lcd.print("I:"); lcd.print(current, 3); lcd.print("A   ");
}

void showFaultLCD(float current) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("EARTH LEAKAGE!");
  lcd.setCursor(0, 1); lcd.print("I="); lcd.print(current, 3); lcd.print("A TRIP");
}

void sendJSON(float voltage, float current, bool fault, float trip, unsigned long tTime) {
  Serial.print("{\"type\":\"data\",");
  Serial.print("\"voltage\":"); Serial.print(voltage, 3); Serial.print(",");
  Serial.print("\"current\":"); Serial.print(current, 3); Serial.print(",");
  Serial.print("\"fault\":"); Serial.print(fault ? "true" : "false"); Serial.print(",");
  Serial.print("\"tripCurrent\":"); Serial.print(trip, 3); Serial.print(",");
  Serial.print("\"tripTime\":"); Serial.print(tTime);
  Serial.println("}");
}

// ── Loop ──────────────────────────────────────────────────────────
void loop() {
  // Check for reset command from web dashboard
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    if (cmd == 'R' && faultState) {
      // Software reset (triggers watchdog or re-init)
      faultState  = false;
      tripCurrent = 0.0f;
      tripTime    = 0;
      vzero = 2.5f;
      // Re-calibrate
      long sum = 0;
      for (int i = 0; i < 200; i++) { sum += analogRead(CURRENT_PIN); delay(2); }
      vzero = (sum / 200.0f) * (AREF_VOLTAGE / ADC_RESOLUTION);
      digitalWrite(RELAY_PIN, RELAY_ON);
      lcd.clear();
      Serial.println("{\"type\":\"reset\",\"status\":\"ok\"}");
    }
  }

  if (faultState) {
    showFaultLCD(tripCurrent);
    unsigned long now = millis();
    if (now - lastSerial >= SERIAL_INTERVAL) {
      sendJSON(0.0f, 0.0f, true, tripCurrent, tripTime);
      lastSerial = now;
    }
    return;   // Stay in fault — only serial reset can escape
  }

  // ── Normal Operation ──
  float voltage = readVoltage();
  float current = readCurrent();
  updateLCD(voltage, current);

  // Check fault button (active LOW)
  if (digitalRead(FAULT_BTN_PIN) == LOW) {
    tripCurrent = current;
    tripTime    = millis();
    faultState  = true;
    digitalWrite(RELAY_PIN, RELAY_OFF);
    showFaultLCD(tripCurrent);
    Serial.print("{\"type\":\"fault\",\"tripCurrent\":");
    Serial.print(tripCurrent, 3);
    Serial.print(",\"tripTime\":");
    Serial.print(tripTime);
    Serial.println("}");
    return;
  }

  // Periodic serial update
  unsigned long now = millis();
  if (now - lastSerial >= SERIAL_INTERVAL) {
    sendJSON(voltage, current, false, 0.0f, 0);
    lastSerial = now;
  }
}
