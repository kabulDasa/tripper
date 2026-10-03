// Pin map — Path A: Waveshare ESP32-S3-LCD-1.28 (docs/build/hardware.md).
// ALL pin numbers for this board live here and nowhere else.
//
// NOT CONFIRMED. The display is wired on the board; GNSS and buttons go on free header
// GPIOs. Fill these in during M1 from the Waveshare wiki for your board revision, and only
// after the human has confirmed the wiring. -1 = not assigned yet.
#pragma once

#define BOARD_NAME "Waveshare ESP32-S3-LCD-1.28"
#define BOARD_PINS_CONFIRMED 0

// GC9A01 display (on-board)
#define PIN_LCD_SCK  -1
#define PIN_LCD_MOSI -1
#define PIN_LCD_CS   -1
#define PIN_LCD_DC   -1
#define PIN_LCD_RST  -1
#define PIN_LCD_BL   -1

// GNSS on UART1
#define PIN_GNSS_RX  -1  // MCU RX  <- GNSS TX
#define PIN_GNSS_TX  -1  // MCU TX  -> GNSS RX

// Buttons (to GND, internal pull-up)
#define PIN_BTN_A    -1
#define PIN_BTN_B    -1

// I2C (on-board QMI8658 IMU; optional BH1750 shares the bus)
#define PIN_I2C_SDA  -1
#define PIN_I2C_SCL  -1
