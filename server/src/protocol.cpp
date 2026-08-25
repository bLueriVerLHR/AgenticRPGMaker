// AgenticRPGMaker — protocol v1 implementation (ADR-004).

#include "protocol.hpp"

#include <chrono>
#include <string>
#include <string_view>

namespace agenticrpg::protocol {
namespace {

// Validates that `type` is a known catalog name; returns the MessageType.
MessageType messageTypeFromString(std::string_view type) {
  if (type == "hello") return MessageType::kHello;
  if (type == "welcome") return MessageType::kWelcome;
  if (type == "player_state") return MessageType::kPlayerState;
  if (type == "chat") return MessageType::kChat;
  if (type == "leave") return MessageType::kLeave;
  if (type == "ping") return MessageType::kPing;
  if (type == "pong") return MessageType::kPong;
  if (type == "error") return MessageType::kError;
  return MessageType::kUnknown;
}

nlohmann::json envelope(std::string_view type, std::optional<std::int64_t> seq,
                        nlohmann::json payload) {
  nlohmann::json msg;
  msg["v"] = kProtocolVersion;
  msg["type"] = std::string(type);
  if (seq.has_value()) {
    msg["seq"] = *seq;
  }
  msg["payload"] = std::move(payload);
  return msg;
}

bool isJsonObject(const nlohmann::json& j) { return j.is_object(); }

}  // namespace

const char* errorCodeString(ErrorCode code) {
  switch (code) {
    case ErrorCode::kProtocolVersionMismatch:
      return "protocol_version_mismatch";
    case ErrorCode::kMalformedMessage:
      return "malformed_message";
    case ErrorCode::kUnknownType:
      return "unknown_type";
    case ErrorCode::kProtocolError:
      return "protocol_error";
    case ErrorCode::kRoomNotFound:
      return "room_not_found";
    case ErrorCode::kRoomFull:
      return "room_full";
    case ErrorCode::kNameTaken:
      return "name_taken";
    case ErrorCode::kProjectMismatch:
      return "project_mismatch";
    case ErrorCode::kRateLimited:
      return "rate_limited";
    case ErrorCode::kInternalError:
      return "internal_error";
  }
  return "internal_error";
}

ParseStatus parseEnvelope(const std::string& raw, ParsedMessage& out) {
  nlohmann::json root;
  try {
    root = nlohmann::json::parse(raw);
  } catch (const nlohmann::json::parse_error&) {
    out.status = ParseStatus::kNotJson;
    return out.status;
  }

  if (!isJsonObject(root)) {
    out.status = ParseStatus::kMalformed;
    return out.status;
  }

  // v: required integer. If present but different -> version mismatch.
  if (!root.contains("v") || !root["v"].is_number_integer()) {
    out.status = ParseStatus::kMalformed;
    return out.status;
  }
  const int version = root["v"].get<int>();
  if (version != kProtocolVersion) {
    out.clientVersion = version;
    out.status = ParseStatus::kVersionMismatch;
    return out.status;
  }

  // type: required string, must be in the catalog.
  if (!root.contains("type") || !root["type"].is_string()) {
    out.status = ParseStatus::kMalformed;
    return out.status;
  }
  const std::string type = root["type"].get<std::string>();
  out.type = messageTypeFromString(type);
  if (out.type == MessageType::kUnknown) {
    out.status = ParseStatus::kUnknownType;
    return out.status;
  }

  // seq: optional integer.
  if (root.contains("seq")) {
    if (!root["seq"].is_number_integer()) {
      out.status = ParseStatus::kMalformed;
      return out.status;
    }
    out.seq = root["seq"].get<std::int64_t>();
  }

  // payload: required object.
  if (!root.contains("payload") || !isJsonObject(root["payload"])) {
    out.status = ParseStatus::kMalformed;
    return out.status;
  }
  out.payload = root["payload"];

  out.status = ParseStatus::kOk;
  return out.status;
}

bool parseHelloPayload(const nlohmann::json& payload, std::string& playerName,
                       std::string& roomId, std::optional<std::string>& projectId) {
  if (!payload.contains("playerName") || !payload["playerName"].is_string()) {
    return false;
  }
  if (!payload.contains("roomId") || !payload["roomId"].is_string()) {
    return false;
  }
  playerName = payload["playerName"].get<std::string>();
  roomId = payload["roomId"].get<std::string>();
  if (payload.contains("projectId")) {
    if (!payload["projectId"].is_string()) {
      return false;
    }
    projectId = payload["projectId"].get<std::string>();
  } else {
    projectId.reset();
  }
  return true;
}

bool parsePlayerStatePayload(const nlohmann::json& payload, nlohmann::json& state,
                             std::optional<double>& clientTimeMs) {
  if (!payload.contains("state") || !payload["state"].is_object()) {
    return false;
  }
  state = payload["state"];
  if (payload.contains("clientTimeMs")) {
    if (!payload["clientTimeMs"].is_number()) {
      return false;
    }
    clientTimeMs = payload["clientTimeMs"].get<double>();
  } else {
    clientTimeMs.reset();
  }
  return true;
}

bool parseChatPayload(const nlohmann::json& payload, std::string& text) {
  if (!payload.contains("text") || !payload["text"].is_string()) {
    return false;
  }
  text = payload["text"].get<std::string>();
  return text.size() <= kMaxChatChars;
}

bool parseLeavePayload(const nlohmann::json& payload, std::string& reason) {
  reason = "user_quit";
  if (payload.contains("reason")) {
    if (!payload["reason"].is_string()) {
      return false;
    }
    reason = payload["reason"].get<std::string>();
  }
  return true;
}

bool parsePingPayload(const nlohmann::json& payload, std::optional<double>& clientTimeMs) {
  if (payload.contains("clientTimeMs")) {
    if (!payload["clientTimeMs"].is_number()) {
      return false;
    }
    clientTimeMs = payload["clientTimeMs"].get<double>();
  } else {
    clientTimeMs.reset();
  }
  return true;
}

nlohmann::json makeError(ErrorCode code, const std::string& message,
                         std::optional<nlohmann::json> detail) {
  nlohmann::json payload;
  payload["code"] = errorCodeString(code);
  payload["message"] = message;
  if (detail.has_value()) {
    payload["detail"] = std::move(*detail);
  }
  return envelope("error", std::nullopt, std::move(payload));
}

nlohmann::json makeWelcome(const std::string& sessionId, const std::string& roomId,
                           const std::optional<std::string>& projectId,
                           std::int64_t serverTimeMs, const nlohmann::json& players) {
  nlohmann::json payload;
  payload["sessionId"] = sessionId;
  payload["roomId"] = roomId;
  if (projectId.has_value()) {
    payload["projectId"] = *projectId;
  }
  payload["serverTimeMs"] = serverTimeMs;
  payload["players"] = players;
  return envelope("welcome", std::nullopt, std::move(payload));
}

nlohmann::json makePlayerStateBroadcast(const std::string& sessionId,
                                        const nlohmann::json& state,
                                        std::optional<double> clientTimeMs,
                                        std::int64_t serverTimeMs) {
  nlohmann::json payload;
  payload["sessionId"] = sessionId;
  payload["state"] = state;
  if (clientTimeMs.has_value()) {
    payload["clientTimeMs"] = *clientTimeMs;
  }
  payload["serverTimeMs"] = serverTimeMs;
  return envelope("player_state", std::nullopt, std::move(payload));
}

nlohmann::json makeChatBroadcast(const std::string& sessionId, const std::string& playerName,
                                 const std::string& text, std::int64_t serverTimeMs) {
  nlohmann::json payload;
  payload["sessionId"] = sessionId;
  payload["playerName"] = playerName;
  payload["text"] = text;
  payload["serverTimeMs"] = serverTimeMs;
  return envelope("chat", std::nullopt, std::move(payload));
}

nlohmann::json makeLeaveBroadcast(const std::string& sessionId, const std::string& playerName,
                                  const std::string& reason) {
  nlohmann::json payload;
  payload["sessionId"] = sessionId;
  payload["playerName"] = playerName;
  payload["reason"] = reason;
  return envelope("leave", std::nullopt, std::move(payload));
}

nlohmann::json makePong(std::optional<double> clientTimeMs, std::int64_t serverTimeMs) {
  nlohmann::json payload;
  if (clientTimeMs.has_value()) {
    payload["clientTimeMs"] = *clientTimeMs;
  }
  payload["serverTimeMs"] = serverTimeMs;
  return envelope("pong", std::nullopt, std::move(payload));
}

std::string toJsonString(const nlohmann::json& message) { return message.dump(); }

std::int64_t nowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

}  // namespace agenticrpg::protocol