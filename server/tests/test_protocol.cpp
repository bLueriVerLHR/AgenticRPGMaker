// AgenticRPGMaker — protocol v1 parse/validate + message builder unit tests.
//
// ADR-004 is the normative wire description for the server; these tests pin the
// envelope, the message catalog and the exact JSON shapes to it.

#include <catch2/catch.hpp>

#include <string>

#include "protocol.hpp"

using agenticrpg::protocol::ParsedMessage;
using agenticrpg::protocol::ParseStatus;

TEST_CASE("protocol: valid envelope parses", "[unit][protocol]") {
  const std::string raw =
      R"({"v":1,"type":"player_state","seq":7,"payload":{"state":{"x":1},"clientTimeMs":123}})";
  ParsedMessage out;
  REQUIRE(agenticrpg::protocol::parseEnvelope(raw, out) == ParseStatus::kOk);
  REQUIRE(out.type == agenticrpg::protocol::MessageType::kPlayerState);
  REQUIRE(out.seq.has_value());
  REQUIRE(*out.seq == 7);
  REQUIRE(out.payload.contains("state"));
}

TEST_CASE("protocol: every message carries v; missing v is malformed", "[unit][protocol]") {
  ParsedMessage out;
  REQUIRE(agenticrpg::protocol::parseEnvelope(R"({"type":"hello","payload":{}})", out) ==
          ParseStatus::kMalformed);
  REQUIRE(agenticrpg::protocol::parseEnvelope(R"({"v":1,"payload":{}})", out) ==
          ParseStatus::kMalformed);
  REQUIRE(agenticrpg::protocol::parseEnvelope(R"({"v":1,"type":"hello"})", out) ==
          ParseStatus::kMalformed);
  REQUIRE(agenticrpg::protocol::parseEnvelope(R"({"v":"1","type":"hello","payload":{}})", out) ==
          ParseStatus::kMalformed);
}

TEST_CASE("protocol: version mismatch is detected with the client version", "[unit][protocol]") {
  ParsedMessage out;
  REQUIRE(agenticrpg::protocol::parseEnvelope(R"({"v":2,"type":"hello","payload":{}})", out) ==
          ParseStatus::kVersionMismatch);
  REQUIRE(out.clientVersion == 2);
  REQUIRE(agenticrpg::protocol::parseEnvelope(R"({"v":99,"type":"x","payload":{}})", out) ==
          ParseStatus::kVersionMismatch);
}

TEST_CASE("protocol: non-JSON is not JSON", "[unit][protocol]") {
  ParsedMessage out;
  REQUIRE(agenticrpg::protocol::parseEnvelope("not json", out) == ParseStatus::kNotJson);
  REQUIRE(agenticrpg::protocol::parseEnvelope("[1,2,3]", out) == ParseStatus::kMalformed);
  REQUIRE(agenticrpg::protocol::parseEnvelope("", out) == ParseStatus::kNotJson);
}

TEST_CASE("protocol: unknown type is reported once", "[unit][protocol]") {
  ParsedMessage out;
  REQUIRE(agenticrpg::protocol::parseEnvelope(
              R"({"v":1,"type":"bogus_type","payload":{}})", out) ==
          ParseStatus::kUnknownType);
  REQUIRE(agenticrpg::protocol::parseEnvelope(
              R"({"v":1,"type":"world_state","payload":{}})", out) ==
          ParseStatus::kUnknownType);  // reserved, undefined in v1
}

TEST_CASE("protocol: payload shape validation", "[unit][protocol]") {
  std::string playerName, roomId;
  std::optional<std::string> projectId;

  REQUIRE(agenticrpg::protocol::parseHelloPayload(
      nlohmann::json::parse(R"({"playerName":"Aria","roomId":"r","projectId":"p"})"),
      playerName, roomId, projectId));
  REQUIRE(playerName == "Aria");
  REQUIRE(roomId == "r");
  REQUIRE(projectId == "p");

  REQUIRE_FALSE(agenticrpg::protocol::parseHelloPayload(
      nlohmann::json::parse(R"({"playerName":5,"roomId":"r"})"), playerName, roomId,
      projectId));
  REQUIRE_FALSE(agenticrpg::protocol::parseHelloPayload(
      nlohmann::json::parse(R"({"playerName":"Aria"})"), playerName, roomId, projectId));

  nlohmann::json state;
  std::optional<double> clientTimeMs;
  REQUIRE(agenticrpg::protocol::parsePlayerStatePayload(
      nlohmann::json::parse(R"({"state":{"x":1.5,"y":2},"clientTimeMs":123})"), state,
      clientTimeMs));
  REQUIRE(state["x"] == 1.5);
  REQUIRE(clientTimeMs == 123.0);

  REQUIRE_FALSE(agenticrpg::protocol::parsePlayerStatePayload(
      nlohmann::json::parse(R"({"clientTimeMs":1})"), state, clientTimeMs));

  std::string text;
  REQUIRE(agenticrpg::protocol::parseChatPayload(nlohmann::json::parse(R"({"text":"hi"})"),
                                                 text));
  REQUIRE(text == "hi");
  // > 200 chars is rejected.
  std::string longText(201, 'a');
  REQUIRE_FALSE(agenticrpg::protocol::parseChatPayload(
      nlohmann::json::parse("{\"text\":\"" + longText + "\"}"), text));
  std::string exactly200(200, 'a');
  REQUIRE(agenticrpg::protocol::parseChatPayload(
      nlohmann::json::parse("{\"text\":\"" + exactly200 + "\"}"), text));

  std::string reason;
  REQUIRE(agenticrpg::protocol::parseLeavePayload(
      nlohmann::json::parse(R"({"reason":"user_quit"})"), reason));
  REQUIRE(reason == "user_quit");
  REQUIRE(agenticrpg::protocol::parseLeavePayload(nlohmann::json::parse(R"({})"), reason));
  REQUIRE(reason == "user_quit");
}

TEST_CASE("protocol: message builders produce the ADR-004 shapes", "[unit][protocol]") {
  using agenticrpg::protocol::ErrorCode;

  const auto error = agenticrpg::protocol::makeError(
      ErrorCode::kProtocolVersionMismatch, "server requires protocol version 1",
      nlohmann::json{{"serverVersion", 1}, {"clientVersion", 2}});
  REQUIRE(error["v"] == 1);
  REQUIRE(error["type"] == "error");
  REQUIRE(error["payload"]["code"] == "protocol_version_mismatch");
  REQUIRE(error["payload"]["detail"]["clientVersion"] == 2);

  const auto welcome = agenticrpg::protocol::makeWelcome(
      "s-1", "room-alpha", std::string("prj-x"), 1234,
      nlohmann::json::parse(R"([{"sessionId":"s-1","playerName":"Aria"}])"));
  REQUIRE(welcome["type"] == "welcome");
  REQUIRE(welcome["payload"]["sessionId"] == "s-1");
  REQUIRE(welcome["payload"]["roomId"] == "room-alpha");
  REQUIRE(welcome["payload"]["projectId"] == "prj-x");
  REQUIRE(welcome["payload"]["serverTimeMs"] == 1234);
  REQUIRE(welcome["payload"]["players"].size() == 1);

  const auto state = agenticrpg::protocol::makePlayerStateBroadcast(
      "s-9", nlohmann::json{{"x", 16}, {"y", 12}}, 55.0, 999);
  REQUIRE(state["type"] == "player_state");
  REQUIRE(state["payload"]["sessionId"] == "s-9");
  REQUIRE(state["payload"]["state"]["x"] == 16);
  REQUIRE(state["payload"]["clientTimeMs"] == 55.0);
  REQUIRE(state["payload"]["serverTimeMs"] == 999);

  const auto chat = agenticrpg::protocol::makeChatBroadcast("s-9", "Kibo", "hi", 1000);
  REQUIRE(chat["type"] == "chat");
  REQUIRE(chat["payload"]["playerName"] == "Kibo");
  REQUIRE(chat["payload"]["text"] == "hi");

  const auto leave = agenticrpg::protocol::makeLeaveBroadcast("s-9", "Kibo", "user_quit");
  REQUIRE(leave["type"] == "leave");
  REQUIRE(leave["payload"]["sessionId"] == "s-9");
  REQUIRE(leave["payload"]["reason"] == "user_quit");

  const auto pong = agenticrpg::protocol::makePong(42.0, 2000);
  REQUIRE(pong["type"] == "pong");
  REQUIRE(pong["payload"]["clientTimeMs"] == 42.0);
  REQUIRE(pong["payload"]["serverTimeMs"] == 2000);
}

TEST_CASE("protocol: error code strings", "[unit][protocol]") {
  using agenticrpg::protocol::ErrorCode;
  REQUIRE(std::string(agenticrpg::protocol::errorCodeString(
              ErrorCode::kProtocolVersionMismatch)) == "protocol_version_mismatch");
  REQUIRE(std::string(agenticrpg::protocol::errorCodeString(ErrorCode::kMalformedMessage)) ==
          "malformed_message");
  REQUIRE(std::string(agenticrpg::protocol::errorCodeString(ErrorCode::kUnknownType)) ==
          "unknown_type");
  REQUIRE(std::string(agenticrpg::protocol::errorCodeString(ErrorCode::kProtocolError)) ==
          "protocol_error");
  REQUIRE(std::string(agenticrpg::protocol::errorCodeString(ErrorCode::kRoomFull)) ==
          "room_full");
  REQUIRE(std::string(agenticrpg::protocol::errorCodeString(ErrorCode::kNameTaken)) ==
          "name_taken");
  REQUIRE(std::string(agenticrpg::protocol::errorCodeString(ErrorCode::kRateLimited)) ==
          "rate_limited");
}
