// AgenticRPGMaker — per-client rate limiting implementation.

#include "rate_limiter.hpp"

#include "protocol.hpp"

namespace agenticrpg {

TokenBucket::TokenBucket(double capacity, double refillPerSecond,
                         std::chrono::steady_clock::time_point now)
    : capacity_(capacity),
      refillPerSecond_(refillPerSecond),
      tokens_(capacity),
      lastRefill_(now) {}

bool TokenBucket::tryConsume(std::chrono::steady_clock::time_point now) {
  const double elapsed =
      std::chrono::duration<double>(now - lastRefill_).count();
  if (elapsed > 0) {
    tokens_ = std::min(capacity_, tokens_ + elapsed * refillPerSecond_);
    lastRefill_ = now;
  }
  if (tokens_ < 1.0) {
    return false;
  }
  tokens_ -= 1.0;
  return true;
}

RateLimiter::RateLimiter()
    : state_(protocol::kStateBurst, protocol::kStateRateHz,
             std::chrono::steady_clock::now()),
      chat_(protocol::kChatRatePerSecond, protocol::kChatRatePerSecond,
            std::chrono::steady_clock::now()) {}

bool RateLimiter::tryState(std::chrono::steady_clock::time_point now) {
  return state_.tryConsume(now);
}

bool RateLimiter::tryChat(std::chrono::steady_clock::time_point now) {
  return chat_.tryConsume(now);
}

bool RateLimiter::tryHello() {
  if (helloUsed_) {
    return false;
  }
  helloUsed_ = true;
  return true;
}

}  // namespace agenticrpg