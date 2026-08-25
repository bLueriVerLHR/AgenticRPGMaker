// AgenticRPGMaker — protocol v1 envelope parse/validate + message builders.
//
// Implements ADR-004 (Multiplayer protocol v1): every message is a JSON
// envelope {v, type, seq?, payload}. The C++ server cannot import the shared
// TS schemas, so this ADR is the normative wire description (ADR-004 §
// "Shared JSON schema") and the source of truth for the Catch2 protocol tests.

#ifndef AGENTICRPG_SERVER_PROTOCOL_HPP
#define AGENTICRPG_SERVER_PROTOCOL_HPP

#include <cstdint>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace agenticrpg::protocol {

inline constexpr int kProtocolVersion = 1;

// Wire constants from ADR-004 rate/backpressure table.
inline constexpr std::size_t kMaxMessageBytes = 4 * 1024;   // 4 KiB per message
inline constexpr std::size_t kMaxChatChars = 200;           // chat text cap
inline constexpr int kStateRateHz = 10;
inline constexpr int kStateBurst = 15;
inline constexpr int kChatRatePerSecond = 2;
inline constexpr std::size_t kOutboundQueueCap = 512;
inline constexpr int kIdleTimeoutSeconds = 60;
inline constexpr std::uint16_t kDefaultMaxPlayersPerRoom = 16;

// Error codes for v1 (ADR-004 table).
enum class ErrorCode {
  kProtocolVersionMismatch,
  kMalformedMessage,
  kUnknownType,
  kProtocolError,
  kRoomNotFound,
  kRoomFull,
  kNameTaken,
  kProjectMismatch,
  kRateLimited,
  kInternalError,
};

// Wire string for an ErrorCode.
const char* errorCodeString(ErrorCode code);

// The message catalog (ADR-004).
enum class MessageType {
  kHello,
  kWelcome,
  kPlayerState,
  kChat,
  kLeave,
  kPing,
  kPong,
  kError,
  kUnknown,
};

// Parse outcome for a raw envelope.
enum class ParseStatus {
  kOk,
  kNotJson,             // not valid JSON
  kMalformed,           // missing v/type/payload or wrong shape
  kVersionMismatch,     // v present but != supported version
  kUnknownType,         // type not in the catalog
};

// Result of parsing a raw inbound message.
struct ParsedMessage {
  ParseStatus status = ParseStatus::kNotJson;
  MessageType type = MessageType::kUnknown;
  std::optional<std::int64_t> seq;
  nlohmann::json payload;  // validated/empty on failure
  int clientVersion = kProtocolVersion;  // set when status == kVersionMismatch
};

// Validates a raw payload string (bounded to kMaxMessageBytes by the caller).
// Never throws; populates `out` with the parse outcome.
ParseStatus parseEnvelope(const std::string& raw, ParsedMessage& out);

// Typed accessors for payloads. Each returns false on wrong shape.
bool parseHelloPayload(const nlohmann::json& payload, std::string& playerName,
                       std::string& roomId, std::optional<std::string>& projectId);
bool parsePlayerStatePayload(const nlohmann::json& payload, nlohmann::json& state,
                             std::optional<double>& clientTimeMs);
bool parseChatPayload(const nlohmann::json& payload, std::string& text);
bool parseLeavePayload(const nlohmann::json& payload, std::string& reason);
bool parsePingPayload(const nlohmann::json& payload, std::optional<double>& clientTimeMs);

// ---- S->C message builders (ADR-004 exact shapes) ---------------------------

nlohmann::json makeError(ErrorCode code, const std::string& message,
                         std::optional<nlohmann::json> detail = std::nullopt);

// players: [{sessionId, playerName, state?}]
nlohmann::json makeWelcome(const std::string& sessionId, const std::string& roomId,
                           const std::optional<std::string>& projectId,
                           std::int64_t serverTimeMs, const nlohmann::json& players);

nlohmann::json makePlayerStateBroadcast(const std::string& sessionId,
                                        const nlohmann::json& state,
                                        std::optional<double> clientTimeMs,
                                        std::int64_t serverTimeMs);

nlohmann::json makeChatBroadcast(const std::string& sessionId, const std::string& playerName,
                                 const std::string& text, std::int64_t serverTimeMs);

nlohmann::json makeLeaveBroadcast(const std::string& sessionId, const std::string& playerName,
                                  const std::string& reason);

nlohmann::json makePong(std::optional<double> clientTimeMs, std::int64_t serverTimeMs);

// Serializes a message object to its wire form.
std::string toJsonString(const nlohmann::json& message);

// Current wall-clock time in milliseconds since the Unix epoch (serverTimeMs).
std::int64_t nowMs();

}  // namespace agenticrpg::protocol

#endif  // AGENTICRPG_SERVER_PROTOCOL_HPP