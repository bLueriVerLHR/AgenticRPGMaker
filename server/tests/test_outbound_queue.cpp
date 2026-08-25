// AgenticRPGMaker — outbound queue unit tests.
//
// ADR-004 backpressure: bounded FIFO (~512), player_state coalesces
// (self-replacing, latest wins), control messages are never dropped, and a
// full queue reports overflow (slow-consumer) instead of dropping control.

#include <catch2/catch.hpp>

#include <string>

#include "outbound_queue.hpp"

using agenticrpg::EnqueueResult;
using agenticrpg::OutboundQueue;

TEST_CASE("queue: player_state coalesces to the latest", "[unit][queue]") {
  OutboundQueue q(8);
  REQUIRE(q.pushState("state-1") == EnqueueResult::kPushed);
  REQUIRE(q.pushState("state-2") == EnqueueResult::kPushed);  // replaces
  REQUIRE(q.pushState("state-3") == EnqueueResult::kPushed);  // replaces
  REQUIRE(q.size() == 1);
  REQUIRE(q.popFront() == "state-3");  // only the latest survives
  REQUIRE(q.empty());
}

TEST_CASE("queue: state and control interleave correctly", "[unit][queue]") {
  OutboundQueue q(8);
  q.pushControl("welcome");
  q.pushState("state-a");
  q.pushControl("chat");
  q.pushState("state-b");  // coalesces state-a in place
  REQUIRE(q.size() == 3);
  REQUIRE(q.popFront() == "welcome");
  // The coalesced state kept state-a's FIFO slot (before the chat message).
  REQUIRE(q.popFront() == "state-b");
  REQUIRE(q.popFront() == "chat");
  REQUIRE(q.empty());
}

TEST_CASE("queue: bounded — state is dropped when full of control", "[unit][queue]") {
  OutboundQueue q(3);
  q.pushControl("c1");
  q.pushControl("c2");
  q.pushControl("c3");
  REQUIRE(q.full());
  // No pending state: the incoming state cannot be queued and is dropped.
  REQUIRE(q.pushState("state-x") == EnqueueResult::kDropped);
  REQUIRE(q.droppedStates() == 1);
  REQUIRE(q.size() == 3);
  // Control messages are untouched.
  REQUIRE(q.popFront() == "c1");
  REQUIRE(q.popFront() == "c2");
  REQUIRE(q.popFront() == "c3");
  REQUIRE(q.empty());
}

TEST_CASE("queue: control overflow is reported, never dropped", "[unit][queue]") {
  OutboundQueue q(3);
  q.pushControl("c1");
  q.pushControl("c2");
  q.pushControl("c3");
  REQUIRE(q.full());
  REQUIRE(q.pushControl("c4") == EnqueueResult::kOverflow);
  REQUIRE(q.size() == 3);  // c4 did not enter, no control was dropped
}

TEST_CASE("queue: coalescing a full queue of states keeps the newest",
          "[unit][queue]") {
  OutboundQueue q(4);
  q.pushControl("ctrl");  // occupies one slot
  q.pushState("s1");
  q.pushState("s2");  // coalesces s1
  q.pushState("s3");  // coalesces s2
  REQUIRE(q.size() == 2);
  REQUIRE(q.popFront() == "ctrl");
  REQUIRE(q.popFront() == "s3");
  REQUIRE(q.empty());
}

TEST_CASE("queue: popFront bookkeeping keeps coalescing correct", "[unit][queue]") {
  OutboundQueue q(8);
  q.pushState("s1");
  q.pushControl("c1");
  REQUIRE(q.popFront() == "s1");  // state popped -> stateIndex cleared
  REQUIRE(q.pushState("s2") == EnqueueResult::kPushed);  // new pending state
  REQUIRE(q.popFront() == "c1");
  REQUIRE(q.popFront() == "s2");
  REQUIRE(q.empty());
}