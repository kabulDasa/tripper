// Selects the pin map for the board being built (set by the PlatformIO env).
#pragma once

#if defined(BOARD_WAVESHARE_128)
#include "board_waveshare_128.h"
#elif defined(BOARD_DEVKIT_N16R8)
#include "board_devkit_n16r8.h"
#else
#error "No board selected: build with -DBOARD_WAVESHARE_128 or -DBOARD_DEVKIT_N16R8"
#endif
