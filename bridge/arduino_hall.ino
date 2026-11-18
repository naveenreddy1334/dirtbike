// VYORA: two gym-cycle Hall sensors -> serial. One pulse per crank rotation.
// Prints "1" for bike 1 and "2" for bike 2 (9600 baud). Same protocol as your sketch, with debounce + safe counters.
// Wiring: Hall OUT -> pin 2 (bike 1), pin 3 (bike 2); VCC -> 5V; GND -> GND. (Uno/Nano/Mega: pins 2,3 support interrupts.)
const int bike1Pin = 2;
const int bike2Pin = 3;
const unsigned long DEBOUNCE_US = 120000UL;   // ignore pulses closer than 120 ms (max ~500 rpm)

volatile unsigned long last1 = 0, last2 = 0;
volatile uint8_t pend1 = 0, pend2 = 0;

void bike1Count() { unsigned long n = micros(); if (n - last1 > DEBOUNCE_US) { last1 = n; if (pend1 < 255) pend1++; } }
void bike2Count() { unsigned long n = micros(); if (n - last2 > DEBOUNCE_US) { last2 = n; if (pend2 < 255) pend2++; } }

void setup() {
  Serial.begin(9600);
  pinMode(bike1Pin, INPUT_PULLUP);
  pinMode(bike2Pin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(bike1Pin), bike1Count, FALLING);
  attachInterrupt(digitalPinToInterrupt(bike2Pin), bike2Count, FALLING);
}

void loop() {
  uint8_t a, b;
  noInterrupts(); a = pend1; b = pend2; pend1 = 0; pend2 = 0; interrupts();   // read-and-clear without losing a pulse
  while (a--) Serial.println(1);
  while (b--) Serial.println(2);
}
