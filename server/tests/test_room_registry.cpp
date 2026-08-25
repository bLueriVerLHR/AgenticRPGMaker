// AgenticRPGMaker — room registry unit tests.
//
// Covers ADR-005 room semantics: join/leave, room_full, name_taken,
// project_mismatch, auto-create and the last-known player_state store.

#include <catch2/catch.hpp>

#include <optional>
#include <string>

#include "room_registry.hpp"

using agenticrpg::JoinResult;
using agenticrpg::RoomRegistry;

TEST_CASE("room: join/leave lifecycle with last-known state", "[unit][room]") {
  RoomRegistry registry;
  registry.getOrCreateRoom("r1");  // the server auto-creates rooms on hello
  std::string sidA, sidB;

  REQUIRE(registry.join("r1", "Aria", std::nullopt, sidA) == JoinResult::kOk);
  REQUIRE(sidA.rfind("s-", 0) == 0);
  REQUIRE(registry.join("r1", "Kibo", std::nullopt, sidB) == JoinResult::kOk);
  REQUIRE(sidB != sidA);

  const agenticrpg::Room* room = registry.findRoom("r1");
  REQUIRE(room != nullptr);
  REQUIRE(room->members.size() == 2);

  // No state yet.
  REQUIRE_FALSE(room->members[0].lastState.has_value());

  registry.updateMemberState("r1", sidA, nlohmann::json{{"x", 5}, {"y", 6}});
  room = registry.findRoom("r1");
  REQUIRE(room != nullptr);
  REQUIRE(room->members[0].lastState.has_value());
  REQUIRE((*room->members[0].lastState)["x"] == 5);

  // Update replaces the previous state (latest wins).
  registry.updateMemberState("r1", sidA, nlohmann::json{{"x", 9}});
  room = registry.findRoom("r1");
  REQUIRE((*room->members[0].lastState)["x"] == 9);

  REQUIRE(registry.removeMember("r1", sidA));
  room = registry.findRoom("r1");
  REQUIRE(room->members.size() == 1);
  REQUIRE_FALSE(registry.removeMember("r1", sidA));  // already gone
  REQUIRE(registry.removeMember("r1", sidB));
  REQUIRE(registry.findRoom("r1")->members.empty());
}

TEST_CASE("room: name_taken and room_full", "[unit][room]") {
  RoomRegistry registry(2);  // cap of 2 players
  registry.getOrCreateRoom("r2");
  registry.getOrCreateRoom("other");
  std::string sid;
  REQUIRE(registry.join("r2", "Aria", std::nullopt, sid) == JoinResult::kOk);
  // Same name in the same room -> name_taken.
  REQUIRE(registry.join("r2", "Aria", std::nullopt, sid) == JoinResult::kNameTaken);
  // Same name in a different room is fine.
  REQUIRE(registry.join("other", "Aria", std::nullopt, sid) == JoinResult::kOk);

  std::string sid2;
  REQUIRE(registry.join("r2", "Kibo", std::nullopt, sid2) == JoinResult::kOk);
  // Room cap reached -> room_full.
  REQUIRE(registry.join("r2", "Zed", std::nullopt, sid) == JoinResult::kRoomFull);
}

TEST_CASE("room: project mismatch is rejected, first joiner locks the project",
          "[unit][room]") {
  RoomRegistry registry;
  registry.getOrCreateRoom("r3");
  std::string sid;
  REQUIRE(registry.join("r3", "Aria", std::string("prj-x"), sid) == JoinResult::kOk);

  // Matching project joins fine.
  REQUIRE(registry.join("r3", "Kibo", std::string("prj-x"), sid) == JoinResult::kOk);
  // Different project -> project_mismatch.
  REQUIRE(registry.join("r3", "Zed", std::string("prj-y"), sid) ==
          JoinResult::kProjectMismatch);

  const agenticrpg::Room* room = registry.findRoom("r3");
  REQUIRE(room != nullptr);
  REQUIRE(room->projectId == std::string("prj-x"));
}

TEST_CASE("room: getOrCreateRoom auto-creates; unknown room is not found",
          "[unit][room]") {
  RoomRegistry registry;
  REQUIRE(registry.findRoom("nope") == nullptr);
  registry.getOrCreateRoom("nope");
  REQUIRE(registry.findRoom("nope") != nullptr);
  REQUIRE(registry.roomCount() == 1);
}
