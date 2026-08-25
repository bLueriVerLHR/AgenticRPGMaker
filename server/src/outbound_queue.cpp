// AgenticRPGMaker — outbound queue implementation.

#include "outbound_queue.hpp"

#include <utility>

namespace agenticrpg {

OutboundQueue::OutboundQueue(std::size_t capacity)
    : capacity_(capacity == 0 ? 1 : capacity) {}

EnqueueResult OutboundQueue::pushState(std::string message) {
  // Coalesce: if a player_state is already pending, replace it with the
  // latest — intermediate positions are never buffered (ADR-004 rule 1).
  if (stateIndex_.has_value()) {
    messages_[*stateIndex_] = std::move(message);
    return EnqueueResult::kPushed;
  }
  if (full()) {
    // Queue full of control messages: drop the incoming state (self-replacing
    // stream) rather than any control message (ADR-004 rules 1+2).
    ++droppedStates_;
    return EnqueueResult::kDropped;
  }
  messages_.push_back(std::move(message));
  stateIndex_ = messages_.size() - 1;
  return EnqueueResult::kPushed;
}

EnqueueResult OutboundQueue::pushControl(std::string message) {
  if (full()) {
    // Control messages are never dropped (ADR-004 rule 2); report overflow so
    // the caller can apply slow-consumer handling.
    return EnqueueResult::kOverflow;
  }
  // A control message after a pending state: the state stays coalesceable.
  messages_.push_back(std::move(message));
  return EnqueueResult::kPushed;
}

std::string OutboundQueue::popFront() {
  std::string front = std::move(messages_.front());
  messages_.pop_front();
  if (stateIndex_.has_value()) {
    if (*stateIndex_ == 0) {
      stateIndex_.reset();
    } else {
      --*stateIndex_;
    }
  }
  return front;
}

}  // namespace agenticrpg