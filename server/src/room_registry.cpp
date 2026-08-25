// AgenticRPGMaker — room registry implementation.

#include "room_registry.hpp"

#include <algorithm>
#include <cstdint>
#include <string>

namespace agenticrpg {

const char* joinResultString(JoinResult result) {
  switch (result) {
    case JoinResult::kOk:
      return "ok";
    case JoinResult::kRoomFull:
      return "room_full";
    case JoinResult::kNameTaken:
      return "name_taken";
    case JoinResult::kProjectMismatch:
      return "project_mismatch";
    case JoinResult::kRoomNotFound:
      return "room_not_found";
  }
  return "ok";
}

const Member* Room::findMemberBySession(const std::string& sessionId) const {
  const auto it = std::find_if(members.begin(), members.end(),
                               [&](const Member& m) { return m.sessionId == sessionId; });
  return it == members.end() ? nullptr : &(*it);
}

const Member* Room::findMemberByName(const std::string& playerName) const {
  const auto it = std::find_if(members.begin(), members.end(),
                               [&](const Member& m) { return m.playerName == playerName; });
  return it == members.end() ? nullptr : &(*it);
}

RoomRegistry::RoomRegistry(std::uint16_t defaultMaxPlayers)
    : defaultMaxPlayers_(defaultMaxPlayers == 0 ? 16 : defaultMaxPlayers) {}

Room* RoomRegistry::findRoom(const std::string& roomId) {
  const auto it = rooms_.find(roomId);
  return it == rooms_.end() ? nullptr : &it->second;
}

const Room* RoomRegistry::findRoom(const std::string& roomId) const {
  const auto it = rooms_.find(roomId);
  return it == rooms_.end() ? nullptr : &it->second;
}

Room* RoomRegistry::getOrCreateRoom(const std::string& roomId) {
  auto it = rooms_.find(roomId);
  if (it == rooms_.end()) {
    Room room;
    room.roomId = roomId;
    room.maxPlayers = defaultMaxPlayers_;
    it = rooms_.emplace(roomId, std::move(room)).first;
  }
  return &it->second;
}

JoinResult RoomRegistry::join(const std::string& roomId, const std::string& playerName,
                              const std::optional<std::string>& projectId,
                              std::string& outSessionId) {
  Room* room = findRoom(roomId);
  if (room == nullptr) {
    return JoinResult::kRoomNotFound;
  }
  if (room->isFull()) {
    return JoinResult::kRoomFull;
  }
  if (room->findMemberByName(playerName) != nullptr) {
    return JoinResult::kNameTaken;
  }
  // projectId lock: first joiner pins it; later joiners must match.
  if (projectId.has_value()) {
    if (room->projectId.has_value() && *room->projectId != *projectId) {
      return JoinResult::kProjectMismatch;
    }
    if (!room->projectId.has_value()) {
      room->projectId = *projectId;
    }
  }

  Member member;
  member.sessionId = "s-" + std::to_string(nextSessionId_++);
  member.playerName = playerName;
  member.lastState.reset();
  outSessionId = member.sessionId;
  room->members.push_back(std::move(member));
  return JoinResult::kOk;
}

bool RoomRegistry::removeMember(const std::string& roomId, const std::string& sessionId) {
  Room* room = findRoom(roomId);
  if (room == nullptr) {
    return false;
  }
  const auto it =
      std::remove_if(room->members.begin(), room->members.end(),
                     [&](const Member& m) { return m.sessionId == sessionId; });
  const bool removed = it != room->members.end();
  room->members.erase(it, room->members.end());
  return removed;
}

void RoomRegistry::updateMemberState(const std::string& roomId, const std::string& sessionId,
                                     nlohmann::json state) {
  Room* room = findRoom(roomId);
  if (room == nullptr) {
    return;
  }
  for (Member& m : room->members) {
    if (m.sessionId == sessionId) {
      m.lastState = std::move(state);
      return;
    }
  }
}

}  // namespace agenticrpg