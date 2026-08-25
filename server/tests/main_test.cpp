// AgenticRPGMaker — server unit tests (Catch2, P0 scaffold).
//
// ADR-005: tests are part of the build and run headless. P0 ships one trivial
// test so the C++ test runner is green from the first phase; real unit tests
// (room registry, rate limiter, message parse/validate, HTTP path mapping) and
// the loopback integration test arrive with P3.

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

TEST_CASE("P0 scaffold: test runner is operational", "[unit]") {
  REQUIRE(1 + 1 == 2);
}

TEST_CASE("P0 scaffold: std::string_view works as expected", "[unit]") {
  const std::string value = "AgenticRPGMaker";
  const std::string_view view = value;
  REQUIRE(view.substr(0, 7) == "Agentic");
}
