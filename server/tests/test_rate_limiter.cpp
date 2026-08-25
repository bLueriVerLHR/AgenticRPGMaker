// AgenticRPGMaker — rate limiter unit tests.
//
// Token buckets per ADR-004: player_state 10 Hz / burst 15, chat 2 msg/s,
// hello once per connection. The clock is injected so refill behavior is
// deterministic.

#include <catch2/catch.hpp>

#include <chrono>

#include "protocol.hpp"
#include "rate_limiter.hpp"

using agenticrpg::TokenBucket;
using agenticrpg::RateLimiter;
using Clock = std::chrono::steady_clock;
using agenticrpg::protocol::kStateBurst;
using agenticrpg::protocol::kStateRateHz;

TEST_CASE("rate: token bucket admits the full burst then denies", "[unit][rate]") {
  auto now = Clock::now();
  TokenBucket bucket(kStateBurst, kStateRateHz, now);
  for (int i = 0; i < kStateBurst; ++i) {
    REQUIRE(bucket.tryConsume(now));
  }
  // Burst exhausted: no tokens left.
  REQUIRE_FALSE(bucket.tryConsume(now));
  REQUIRE(bucket.tokens() < 1.0);
}

TEST_CASE("rate: token bucket refills at the configured rate", "[unit][rate]") {
  auto now = Clock::now();
  TokenBucket bucket(kStateBurst, kStateRateHz, now);

  // Drain the whole burst so refill behavior is observable.
  for (int i = 0; i < kStateBurst; ++i) {
    REQUIRE(bucket.tryConsume(now));
  }
  REQUIRE_FALSE(bucket.tryConsume(now));  // empty

  // After 10 Hz, one token is refilled every 100ms.
  const auto refillMs = std::chrono::milliseconds(1000 / kStateRateHz);
  now += refillMs;
  REQUIRE(bucket.tryConsume(now));  // spends the one refilled token
  REQUIRE_FALSE(bucket.tryConsume(now));  // and only one

  // A long pause refills up to capacity but never above burst.
  now += std::chrono::seconds(60);
  REQUIRE(bucket.tryConsume(now));
  REQUIRE(bucket.tokens() < kStateBurst);  // capped at capacity
}

TEST_CASE("rate: RateLimiter state is 10 Hz with burst 15 before denial",
          "[unit][rate]") {
  auto now = std::chrono::steady_clock::now();
  RateLimiter limiter;
  // 15 immediate state updates are allowed (burst).
  for (int i = 0; i < 15; ++i) {
    REQUIRE(limiter.tryState(now));
  }
  // 16th is denied.
  REQUIRE_FALSE(limiter.tryState(now));
}

TEST_CASE("rate: chat allows two per second then denies and refills", "[unit][rate]") {
  auto now = std::chrono::steady_clock::now();
  RateLimiter limiter;
  REQUIRE(limiter.tryChat(now));
  REQUIRE(limiter.tryChat(now));
  REQUIRE_FALSE(limiter.tryChat(now));  // burst of 2 exhausted (0 tokens)
  // 2 msg/s → one token refills every 500ms. Wait a comfortable margin above
  // the interval so floating-point timing can never leave us just below 1.0.
  now += std::chrono::milliseconds(600);
  REQUIRE(limiter.tryChat(now));  // >1 token refilled, spent one
  REQUIRE_FALSE(limiter.tryChat(now));  // spent it
  // A 1s pause refills the full burst of 2.
  now += std::chrono::seconds(1);
  REQUIRE(limiter.tryChat(now));
  REQUIRE(limiter.tryChat(now));
  REQUIRE_FALSE(limiter.tryChat(now));
}

TEST_CASE("rate: hello is allowed exactly once", "[unit][rate]") {
  RateLimiter limiter;
  REQUIRE(limiter.tryHello());
  REQUIRE_FALSE(limiter.tryHello());
  REQUIRE_FALSE(limiter.tryHello());
  REQUIRE(limiter.helloUsed());
}