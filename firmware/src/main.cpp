// M0 skeleton: proves the toolchain, board selection and partition table build.
// Tasks, screens and the upload server arrive in M1/M4/M5/M7.
#include <Arduino.h>

#include "board.h"
#include "navcore/config.h"

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("Tripper DIY skeleton on %s (pins confirmed: %d)\n", BOARD_NAME, BOARD_PINS_CONFIRMED);
  Serial.printf("Flash %u MB, PSRAM %u bytes\n", (unsigned)(ESP.getFlashChipSize() / (1024 * 1024)),
                (unsigned)ESP.getPsramSize());
  Serial.printf("navcore: NEAR at %.0f s / %.0f m\n", nav::cfg::NEAR_T_S, nav::cfg::NEAR_D_M);
}

void loop() { delay(1000); }
