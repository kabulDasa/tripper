// Native unit tests for lib/navcore (pio test -e native). M2 adds geo/matcher/trigger tests.
#include <unity.h>

#include "navcore/config.h"

using namespace nav::cfg;

void setUp() {}
void tearDown() {}

// Phases are entered in order, so each threshold must be tighter than the one before.
void test_phase_thresholds_are_ordered() {
  TEST_ASSERT_TRUE(PREPARE_T_S > NEAR_T_S && NEAR_T_S > NOW_T_S && NOW_T_S > 0);
  TEST_ASSERT_TRUE(PREPARE_D_M > NEAR_D_M && NEAR_D_M > NOW_D_M && NOW_D_M > 0);
}

// Hysteresis: clearing must need a smaller deviation than confirming, or it would flap.
void test_off_route_hysteresis() {
  TEST_ASSERT_TRUE(OFF_ROUTE_CLEAR_D_M < OFF_ROUTE_D_M);
  TEST_ASSERT_TRUE(OFF_ROUTE_D_M < OFF_ROUTE_D_BAD_HDOP_M);
}

void test_heading_threshold_is_8_kmh() {
  TEST_ASSERT_FLOAT_WITHIN(1e-4f, 2.2222f, HEADING_MIN_SPEED_MS);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_phase_thresholds_are_ordered);
  RUN_TEST(test_off_route_hysteresis);
  RUN_TEST(test_heading_threshold_is_8_kmh);
  return UNITY_END();
}
