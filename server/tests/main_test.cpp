// AgenticRPGMaker — Catch2 test runner entry point (CATCH_CONFIG_MAIN lives
// here so the other test translation units only `#include <catch2/catch.hpp>`).
//
// ADR-005: tests are part of the build and run headless; the loopback
// integration test is tagged [integration] and is part of the required suite.

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

TEST_CASE("test runner is operational", "[unit]") {
  REQUIRE(1 + 1 == 2);
}
