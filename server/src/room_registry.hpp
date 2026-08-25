// AgenticRPGMaker — room registry (ADR-005: the "state storage" of the relay).
//
// Rooms are keyed by roomId; each room holds its members with their last-known
// player_state. This is the shared state store the relay reads from and writes
// to. The MVP auto-creates rooms on first join (ADR-004: "MVP may auto-create").

#ifndef AGENTICRPG_SERVER_ROOM_REGISTRY_HPP
#define AGENTICRPG_SERVER_ROOM_REGISTRY_HPP

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace agenticrpg {

// Join outcome codes (ADR-004 error table).
enum class JoinResult {
  kOk,
  kRoomFull,
  kNameTaken,
  kProjectMismatch,
  kRoomNotFound,  // kept for completeness; MVP auto-creates rooms
};

const char* joinResultString(JoinResult result);

struct Member {
  std::string sessionId;
  std::string playerName;
  std::optional<nlohmann::json> lastState;  // last known player_state.state
};

struct Room {
  std::string roomId;
  std::optional<std::string> projectId;  // set by the first joiner, then locked
  std::uint16_t maxPlayers = 16;
  std::vector<Member> members;

  bool isFull() const { return members.size() >= maxPlayers; }
  const Member* findMemberBySession(const std::string& sessionId) const;
  const Member* findMemberByName(const std::string& playerName) const;
};

class RoomRegistry {
 public:
  explicit RoomRegistry(std::uint16_t defaultMaxPlayers = 16);

  // Looks up a room without creating it.
  Room* findRoom(const std::string& roomId);
  const Room* findRoom(const std::string& roomId) const;

  // Auto-creates the room if absent; returns the (possibly new) room.
  Room* getOrCreateRoom(const std::string& roomId);

  // Adds a member. Checks room cap, name uniqueness and projectId lock.
  // On success the member is appended and `outSessionId` is filled.
  JoinResult join(const std::string& roomId, const std::string& playerName,
                  const std::optional<std::string>& projectId, std::string& outSessionId);

  // Removes a member by session id. Returns false when the member was absent.
  bool removeMember(const std::string& roomId, const std::string& sessionId);

  // Updates the last-known player_state of a member. No-op when absent.
  void updateMemberState(const std::string& roomId, const std::string& sessionId,
                         nlohmann::json state);

  // Number of rooms (tests / diagnostics).
  std::size_t roomCount() const { return rooms_.size(); }

 private:
  std::uint16_t defaultMaxPlayers_;
  std::map<std::string, Room> rooms_;
  std::uint64_t nextSessionId_ = 1;
};

}  // namespace agenticrpg

#endif  // AGENTICRPG_SERVER_ROOM_REGISTRY_HPP