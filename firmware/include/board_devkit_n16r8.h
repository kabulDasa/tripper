// Pin map — Path B: ESP32-S3 DevKitC N16R8 + bare GC9A01 module (docs/build/hardware.md).
// ALL pin numbers for this board live here and nowhere else.
//
// These are the *suggested* pins from the docs. Confirm the actual wiring before
// relying on them (M1), then set BOARD_PINS_CONFIRMED to 1.
// Avoid: GPIO 0/3/45/46 (strapping), 19/20 (USB), 26–32 (flash), 33–37 (octal PSRAM), 43/44 (UART0).
#pragma once

#define BOARD_NAME "ESP32-S3 DevKitC N16R8 + GC9A01"
#define BOARD_PINS_CONFIRMED 0

// GC9A01 display (FSPI)
#define PIN_LCD_SCK  12
#define PIN_LCD_MOSI 11
#define PIN_LCD_CS   10
#define PIN_LCD_DC   9
#define PIN_LCD_RST  8
#define PIN_LCD_BL   7   // LEDC PWM

// GNSS on UART1
#define PIN_GNSS_RX  18  // MCU RX  <- GNSS TX
#define PIN_GNSS_TX  17  // MCU TX  -> GNSS RX

// Buttons (to GND, internal pull-up)
#define PIN_BTN_A    4
#define PIN_BTN_B    5

// I2C (optional BH1750)
#define PIN_I2C_SDA  1
#define PIN_I2C_SCL  2
