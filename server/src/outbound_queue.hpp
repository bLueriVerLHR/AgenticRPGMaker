// AgenticRPGMaker — bounded outbound queue with state coalescing (ADR-004).
//
// Per receiving connection: a bounded FIFO (~512 messages). player_state
// broadcasts coalesce (state is self-replacing — intermediate positions are
// dropped, the latest wins); control messages (welcome/chat/leave/error) are
// never dropped — if the queue is full when a control message arrives, the
// caller must treat it as slow-consumer overflow (disconnect after 5s).

#ifndef AGENTICRPG_SERVER_OUTBOUND_QUEUE_HPP
#define AGENTICRPG_SERVER_OUTBOUND_QUEUE_HPP

#include <cstddef>
#include <deque>
#include <optional>
#include <string>

namespace agenticrpg {

enum class EnqueueResult {
  kPushed,    // message queued
  kDropped,   // a player_state was dropped (self-replacing, acceptable)
  kOverflow,  // control message could not be queued (queue full)
};

class OutboundQueue {
 public:
  explicit OutboundQueue(std::size_t capacity);

  // Queues a player_state broadcast, coalescing with any pending state.
  EnqueueResult pushState(std::string message);

  // Queues a control message; never drops — reports overflow when full.
  EnqueueResult pushControl(std::string message);

  bool empty() const { return messages_.empty(); }
  bool full() const { return messages_.size() >= capacity_; }
  std::size_t size() const { return messages_.size(); }
  std::size_t capacity() const { return capacity_; }

  // Pops the oldest queued message (caller must check !empty()).
  std::string popFront();

  // Number of state messages dropped since construction (tests/diagnostics).
  std::size_t droppedStates() const { return droppedStates_; }

 private:
  std::size_t capacity_;
  std::deque<std::string> messages_;
  // Index (into messages_) of the pending coalesceable player_state, if any.
  std::optional<std::size_t> stateIndex_;
  std::size_t droppedStates_ = 0;
};

}  // namespace agenticrpg

#endif  // AGENTICRPG_SERVER_OUTBOUND_QUEUE_HPP