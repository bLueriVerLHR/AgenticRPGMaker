// AgenticRPGMaker — per-client rate limiting (ADR-004).
//
// Token buckets per message class with the ADR-004 defaults: player_state at
// 10 Hz / burst 15, chat at 2 msg/s, hello once per connection. Excess state
// updates are coalesced by the caller (latest wins, intermediates dropped);
// this class only decides allow/deny.

#ifndef AGENTICRPG_SERVER_RATE_LIMITER_HPP
#define AGENTICRPG_SERVER_RATE_LIMITER_HPP

#include <chrono>

namespace agenticrpg {

class TokenBucket {
 public:
  // capacity = burst size; refillPerSecond = steady refill rate.
  TokenBucket(double capacity, double refillPerSecond,
              std::chrono::steady_clock::time_point now);

  // Attempts to consume one token. Refills based on elapsed time.
  bool tryConsume(std::chrono::steady_clock::time_point now);

  double tokens() const { return tokens_; }

 private:
  double capacity_;
  double refillPerSecond_;
  double tokens_;
  std::chrono::steady_clock::time_point lastRefill_;
};

class RateLimiter {
 public:
  RateLimiter();

  // Player_state: 10 Hz / burst 15.
  bool tryState(std::chrono::steady_clock::time_point now);
  // Chat: 2 msg/s (burst 2).
  bool tryChat(std::chrono::steady_clock::time_point now);
  // Hello: once per connection.
  bool tryHello();

  // Diagnostics / tests.
  double stateTokens() const { return state_.tokens(); }
  bool helloUsed() const { return helloUsed_; }

 private:
  TokenBucket state_;
  TokenBucket chat_;
  bool helloUsed_ = false;
};

}  // namespace agenticrpg

#endif  // AGENTICRPG_SERVER_RATE_LIMITER_HPP