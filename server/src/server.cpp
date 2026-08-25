// AgenticRPGMaker — relay/state-sync server implementation (ADR-005 + ADR-004).

#include "server.hpp"

#include <spdlog/spdlog.h>

#include <asio/post.hpp>

#include <exception>
#include <fstream>
#include <sstream>
#include <system_error>
#include <utility>
#include <vector>

#include <websocketpp/common/connection_hdl.hpp>
#include <websocketpp/frame.hpp>

namespace agenticrpg {
namespace {

using websocketpp::lib::placeholders::_1;
using websocketpp::lib::placeholders::_2;

std::string typeName(protocol::MessageType type) {
  switch (type) {
    case protocol::MessageType::kHello: return "hello";
    case protocol::MessageType::kWelcome: return "welcome";
    case protocol::MessageType::kPlayerState: return "player_state";
    case protocol::MessageType::kChat: return "chat";
    case protocol::MessageType::kLeave: return "leave";
    case protocol::MessageType::kPing: return "ping";
    case protocol::MessageType::kPong: return "pong";
    case protocol::MessageType::kError: return "error";
    case protocol::MessageType::kUnknown: return "unknown";
  }
  return "unknown";
}

std::chrono::steady_clock::time_point steadyNow() {
  return std::chrono::steady_clock::now();
}

}  // namespace

Server::Server(ServerConfig cfg)
    : cfg_(std::move(cfg)),
      rooms_(cfg_.maxPlayersPerRoom == 0 ? protocol::kDefaultMaxPlayersPerRoom
                                         : cfg_.maxPlayersPerRoom) {}

void Server::start() {
  io_ = std::make_unique<asio::io_context>();

  // All handlers run on the single io_context thread (ADR-005 §3).
  ws_.init_asio(io_.get());

  // websocketpp's own console logging is silenced; spdlog is the only logger
  // (WAL §2). Access/error channels go nowhere.
  ws_.clear_access_channels(websocketpp::log::alevel::all);
  ws_.clear_error_channels(websocketpp::log::elevel::all);

  ws_.set_open_handler([this](websocketpp::connection_hdl hdl) { onOpen(std::move(hdl)); });
  ws_.set_message_handler(
      [this](websocketpp::connection_hdl hdl, MessagePtr msg) { onMessage(std::move(hdl), std::move(msg)); });
  ws_.set_close_handler([this](websocketpp::connection_hdl hdl) { onClose(std::move(hdl)); });
  ws_.set_fail_handler([this](websocketpp::connection_hdl hdl) { onFail(std::move(hdl)); });
  ws_.set_http_handler([this](websocketpp::connection_hdl hdl) { onHttp(std::move(hdl)); });

  // Hard framing safety net. The protocol-level 4 KiB cap is enforced in
  // onMessage so the server can reply malformed_message before closing.
  ws_.set_max_message_size(64 * 1024);

  ws_.listen(cfg_.port);
  ws_.start_accept();
  startBackpressureMonitor();

  spdlog::info("listening on 0.0.0.0:{} (www={}, editor={}, max_players_per_room={})",
               cfg_.port, cfg_.wwwRoot, cfg_.editorRoot, cfg_.maxPlayersPerRoom);
}

void Server::run() {
  if (io_) {
    io_->run();
  }
}

void Server::runInBackground() {
  thread_ = std::thread([this] { run(); });
}

void Server::stop() {
  // Thread-safe shutdown: this may be called from any thread while the
  // io_context thread is running, so we must not touch session state or the
  // websocketpp endpoint from here (that would race with onClose). Stopping
  // the io_context lets the io thread finish; pending handlers are dropped and
  // the endpoint's destructor cleans up the connections.
  stopped_ = true;
  if (backpressureTimer_) {
    std::error_code ec;
    backpressureTimer_->cancel(ec);
  }
  if (io_) {
    io_->stop();
  }
  if (thread_.joinable()) {
    thread_.join();
  }
}

std::string Server::remoteOf(websocketpp::connection_hdl hdl) {
  try {
    return ws_.get_con_from_hdl(hdl)->get_remote_endpoint();
  } catch (const std::exception&) {
    return "unknown";
  }
}

// ---- websocketpp handlers ----------------------------------------------------

void Server::onOpen(websocketpp::connection_hdl hdl) {
  auto session = std::make_shared<Session>();
  session->hdl = hdl;
  session->connId = "conn-" + std::to_string(nextConnId_++);
  sessions_[hdl] = session;
  armIdleTimer(*session);
  spdlog::info("connect: {} from {}", session->connId, remoteOf(hdl));
}

void Server::onMessage(websocketpp::connection_hdl hdl, MessagePtr msg) {
  auto it = sessions_.find(hdl);
  if (it == sessions_.end()) {
    return;
  }
  Session& s = *it->second;
  armIdleTimer(s);  // any message of any kind resets the idle timer (ADR-004)

  if (msg->get_opcode() != websocketpp::frame::opcode::text) {
    // Binary frames are not part of protocol v1 (JSON transport only).
    sendErrorAndClose(s, protocol::ErrorCode::kMalformedMessage,
                      "binary frames are not supported by protocol v1");
    return;
  }

  const std::string& raw = msg->get_payload();
  const auto t0 = steadyNow();

  // Opt-in per-message diagnostics at debug level (never default). Only the
  // size is logged — chat text is never logged (03-wal-process.md §2).
  spdlog::debug("{}: received {} bytes", s.connId, raw.size());

  if (raw.size() > protocol::kMaxMessageBytes) {
    spdlog::warn("{}: oversized message ({} bytes > {} cap)", s.connId, raw.size(),
                 protocol::kMaxMessageBytes);
    ++s.consecutiveErrors;
    sendError(s, protocol::ErrorCode::kMalformedMessage, "message exceeds 4 KiB cap");
    if (s.consecutiveErrors >= 5) {
      closeConnection(s, websocketpp::close::status::policy_violation, "repeated oversize messages");
    }
    return;
  }

  protocol::ParsedMessage parsed;
  const protocol::ParseStatus status = protocol::parseEnvelope(raw, parsed);

  switch (status) {
    case protocol::ParseStatus::kNotJson:
    case protocol::ParseStatus::kMalformed: {
      ++s.consecutiveErrors;
      spdlog::warn("{}: malformed message ({})", s.connId,
                   status == protocol::ParseStatus::kNotJson ? "not JSON" : "bad envelope");
      sendError(s, protocol::ErrorCode::kMalformedMessage, "malformed message");
      if (s.consecutiveErrors >= 5) {
        closeConnection(s, websocketpp::close::status::policy_violation,
                        "repeated malformed messages");
      }
      return;
    }
    case protocol::ParseStatus::kVersionMismatch: {
      spdlog::warn("{}: protocol version mismatch (client v{}, server v{})", s.connId,
                   parsed.clientVersion, protocol::kProtocolVersion);
      nlohmann::json detail;
      detail["serverVersion"] = protocol::kProtocolVersion;
      detail["clientVersion"] = parsed.clientVersion;
      sendErrorAndClose(s, protocol::ErrorCode::kProtocolVersionMismatch,
                        "server requires protocol version 1", std::move(detail));
      return;
    }
    case protocol::ParseStatus::kUnknownType: {
      // Client should log + ignore; server replies once per connection
      // (ADR-004 extension points).
      if (!s.unknownTypeReported) {
        s.unknownTypeReported = true;
        spdlog::warn("{}: unknown message type", s.connId);
        sendError(s, protocol::ErrorCode::kUnknownType, "unknown message type");
      }
      return;
    }
    case protocol::ParseStatus::kOk:
      break;
  }

  // Dispatch on the message catalog (ADR-004).
  switch (parsed.type) {
    case protocol::MessageType::kHello:
      handleHello(s, parsed);
      break;
    case protocol::MessageType::kPlayerState:
      handlePlayerState(s, parsed);
      break;
    case protocol::MessageType::kChat:
      handleChat(s, parsed);
      break;
    case protocol::MessageType::kLeave:
      handleLeave(s, parsed);
      break;
    case protocol::MessageType::kPing:
      handlePing(s, parsed);
      break;
    case protocol::MessageType::kError:
      // "error" is strictly server→client; a client sending it is a protocol
      // violation, not a catalog type.
      sendError(s, protocol::ErrorCode::kProtocolError,
                "error is a server-to-client message");
      break;
    default:
      break;
  }

  spdlog::debug("{}: handled {} in {} us", s.connId, typeName(parsed.type),
                std::chrono::duration_cast<std::chrono::microseconds>(steadyNow() - t0).count());
}

void Server::onClose(websocketpp::connection_hdl hdl) {
  auto it = sessions_.find(hdl);
  if (it == sessions_.end()) {
    return;
  }
  Session& s = *it->second;
  if (s.idleTimer) {
    std::error_code ec;
    s.idleTimer->cancel(ec);
  }

  // Explicit leave already broadcast in handleLeave; any other close path
  // (abrupt drop, timeout, server shutdown, protocol error) notifies the room.
  if (!s.left && !s.sessionId.empty()) {
    const std::string reason = s.closeReason.empty() ? "disconnect" : s.closeReason;
    broadcastLeave(s, reason);
  }

  if (!s.sessionId.empty()) {
    hdlBySessionId_.erase(s.sessionId);
    rooms_.removeMember(s.roomId, s.sessionId);
    spdlog::info("disconnect: {} (session {}, room {}, reason {})", s.connId, s.sessionId,
                 s.roomId, s.closeReason.empty() ? "disconnect" : s.closeReason);
  } else {
    spdlog::info("disconnect: {} (never joined)", s.connId);
  }
  sessions_.erase(it);
}

void Server::onFail(websocketpp::connection_hdl hdl) {
  // Failed connections never reached onOpen (bad handshake, transport error).
  try {
    spdlog::warn("connection failed: {} ({})", remoteOf(hdl),
                 ws_.get_con_from_hdl(hdl)->get_ec().message());
  } catch (const std::exception&) {
    spdlog::warn("connection failed");
  }
}

// ---- HTTP static serving ------------------------------------------------------

void Server::onHttp(websocketpp::connection_hdl hdl) {
  auto con = ws_.get_con_from_hdl(hdl);
  try {
    // websocketpp HTTP handler contract: the response must be deferred first,
    // then send_http_response() writes it (otherwise send_http_response
    // throws invalid_state and the connection state is ambiguous).
    con->defer_http_response();
    const std::string method = con->get_request().get_method();
    if (method != "GET") {
      con->set_status(websocketpp::http::status_code::method_not_allowed,
                      "Method Not Allowed");
      con->set_body("405 method not allowed\n");
      con->send_http_response();
      return;
    }

  const std::string resource = con->get_uri()->get_resource();
  const StaticFileResult result =
      handleStaticRequest(resource, cfg_.wwwRoot, cfg_.editorRoot);

  if (result.forbidden) {
    spdlog::warn("http: forbidden path '{}'", resource);
    con->set_status(websocketpp::http::status_code::bad_request, "Bad Request");
    con->set_body("400 bad request\n");
    con->send_http_response();
    return;
  }
  if (result.tooLarge) {
    con->set_status(websocketpp::http::status_code::request_entity_too_large,
                    "Payload Too Large");
    con->set_body("413 payload too large\n");
    con->send_http_response();
    return;
  }
  if (result.notFound) {
    con->set_status(websocketpp::http::status_code::not_found, "Not Found");
    con->set_body("404 not found\n");
    con->send_http_response();
    return;
  }

  std::ifstream file(result.path, std::ios::binary);
  if (!file) {
    con->set_status(websocketpp::http::status_code::not_found, "Not Found");
    con->set_body("404 not found\n");
    con->send_http_response();
    return;
  }
  std::ostringstream buffer;
  buffer << file.rdbuf();
  const std::string body = buffer.str();

  con->set_status(websocketpp::http::status_code::ok, "OK");
  con->replace_header("Content-Type", result.mime);
  con->set_body(body);
  con->send_http_response();
  spdlog::debug("http: served '{}' ({} bytes, {})", resource, body.size(), result.mime);
  } catch (const std::exception& e) {
    spdlog::error("http: handler threw: {}", e.what());
  }
}

// ---- protocol dispatch ---------------------------------------------------------

void Server::handleHello(Session& s, const protocol::ParsedMessage& parsed) {
  if (s.helloDone) {
    // A second hello is an error (ADR-004).
    sendErrorAndClose(s, protocol::ErrorCode::kProtocolError, "hello already received");
    return;
  }
  std::string playerName;
  std::string roomId;
  std::optional<std::string> projectId;
  if (!protocol::parseHelloPayload(parsed.payload, playerName, roomId, projectId) ||
      playerName.empty() || roomId.empty()) {
    sendErrorAndClose(s, protocol::ErrorCode::kMalformedMessage, "invalid hello payload");
    return;
  }

  // hello is rate-limited to once per connection; tryHello also guards the
  // helloDone flag above.
  if (!s.limiter.tryHello()) {
    sendErrorAndClose(s, protocol::ErrorCode::kProtocolError, "hello already received");
    return;
  }

  // MVP auto-creates rooms (ADR-004: "MVP may auto-create").
  rooms_.getOrCreateRoom(roomId);
  std::string sessionId;
  const JoinResult join = rooms_.join(roomId, playerName, projectId, sessionId);
  switch (join) {
    case JoinResult::kOk:
      break;
    case JoinResult::kRoomFull:
      sendErrorAndClose(s, protocol::ErrorCode::kRoomFull, "room is full");
      return;
    case JoinResult::kNameTaken:
      sendErrorAndClose(s, protocol::ErrorCode::kNameTaken, "player name already taken");
      return;
    case JoinResult::kProjectMismatch:
      sendErrorAndClose(s, protocol::ErrorCode::kProjectMismatch, "project mismatch");
      return;
    case JoinResult::kRoomNotFound:
    default:
      sendErrorAndClose(s, protocol::ErrorCode::kInternalError, "join failed");
      return;
  }

  s.helloDone = true;
  s.playerName = playerName;
  s.roomId = roomId;
  s.projectId = projectId;
  s.sessionId = sessionId;
  hdlBySessionId_[sessionId] = s.hdl;

  // welcome carries the current occupants including the joiner and their
  // last-known state (ADR-004).
  nlohmann::json players = nlohmann::json::array();
  if (const Room* room = rooms_.findRoom(roomId)) {
    for (const Member& m : room->members) {
      nlohmann::json entry;
      entry["sessionId"] = m.sessionId;
      entry["playerName"] = m.playerName;
      if (m.lastState.has_value()) {
        entry["state"] = *m.lastState;
      }
      players.push_back(std::move(entry));
    }
  }
  const std::string welcome = protocol::toJsonString(protocol::makeWelcome(
      sessionId, roomId, projectId, protocol::nowMs(), players));
  enqueueTo(s, welcome, /*isState=*/false);

  spdlog::info("handshake ok: {} joined room '{}' as '{}' (session {})", s.connId, roomId,
               playerName, sessionId);
}

void Server::handlePlayerState(Session& s, const protocol::ParsedMessage& parsed) {
  if (!s.helloDone) {
    sendError(s, protocol::ErrorCode::kProtocolError, "hello required before player_state");
    return;
  }
  nlohmann::json state;
  std::optional<double> clientTimeMs;
  if (!protocol::parsePlayerStatePayload(parsed.payload, state, clientTimeMs)) {
    sendError(s, protocol::ErrorCode::kMalformedMessage, "invalid player_state payload");
    return;
  }

  const auto now = steadyNow();
  if (!s.limiter.tryState(now)) {
    // Coalesce: the latest state still wins (self-replacing); intermediate
    // updates are dropped rather than queued (ADR-004). Sustained abuse
    // beyond ~3x the limit triggers rate_limited errors, then disconnect.
    rooms_.updateMemberState(s.roomId, s.sessionId, state);
    ++s.stateRateLimitDrops;
    if (s.stateRateLimitDrops >= 3 * protocol::kStateBurst) {
      s.stateRateLimitDrops = 0;
      ++s.stateRateLimitErrors;
      spdlog::warn("{}: player_state rate limit exceeded (error {})", s.connId,
                   s.stateRateLimitErrors);
      sendError(s, protocol::ErrorCode::kRateLimited, "player_state rate limit exceeded");
      if (s.stateRateLimitErrors >= 3) {
        closeConnection(s, websocketpp::close::status::policy_violation,
                        "player_state rate limit abuse");
      }
    }
    return;
  }

  rooms_.updateMemberState(s.roomId, s.sessionId, state);
  broadcastToRoom(s.roomId, s.sessionId,
                  protocol::toJsonString(protocol::makePlayerStateBroadcast(
                      s.sessionId, state, clientTimeMs, protocol::nowMs())),
                  /*isState=*/true);
}

void Server::handleChat(Session& s, const protocol::ParsedMessage& parsed) {
  if (!s.helloDone) {
    sendError(s, protocol::ErrorCode::kProtocolError, "hello required before chat");
    return;
  }
  std::string text;
  if (!protocol::parseChatPayload(parsed.payload, text)) {
    sendError(s, protocol::ErrorCode::kMalformedMessage,
              "invalid chat payload (text must be a string of at most 200 chars)");
    return;
  }

  const auto now = steadyNow();
  if (!s.limiter.tryChat(now)) {
    ++s.chatRateLimitHits;
    spdlog::warn("{}: chat rate limit exceeded (hit {})", s.connId, s.chatRateLimitHits);
    sendError(s, protocol::ErrorCode::kRateLimited, "chat rate limit exceeded");
    if (s.chatRateLimitHits >= 10) {
      closeConnection(s, websocketpp::close::status::policy_violation,
                      "chat rate limit abuse");
    }
    return;
  }

  // Chat text is never logged (personal data, WAL §2). Only the broadcast
  // size/participants are.
  broadcastToRoom(s.roomId, s.sessionId,
                  protocol::toJsonString(protocol::makeChatBroadcast(
                      s.sessionId, s.playerName, text, protocol::nowMs())),
                  /*isState=*/false);
  spdlog::debug("{}: relayed chat ({} chars) to room '{}'", s.connId, text.size(), s.roomId);
}

void Server::handleLeave(Session& s, const protocol::ParsedMessage& parsed) {
  if (!s.helloDone) {
    sendErrorAndClose(s, protocol::ErrorCode::kProtocolError, "hello required before leave");
    return;
  }
  std::string reason;
  if (!protocol::parseLeavePayload(parsed.payload, reason)) {
    sendErrorAndClose(s, protocol::ErrorCode::kMalformedMessage, "invalid leave payload");
    return;
  }
  // S->C leave to the remaining members, then close (ADR-004).
  s.left = true;
  broadcastLeave(s, reason);
  closeConnection(s, websocketpp::close::status::normal, reason);
}

void Server::handlePing(Session& s, const protocol::ParsedMessage& parsed) {
  std::optional<double> clientTimeMs;
  if (!protocol::parsePingPayload(parsed.payload, clientTimeMs)) {
    sendError(s, protocol::ErrorCode::kMalformedMessage, "invalid ping payload");
    return;
  }
  sendDirect(s, protocol::toJsonString(protocol::makePong(clientTimeMs, protocol::nowMs())));
}

// ---- helpers -------------------------------------------------------------------

void Server::sendDirect(Session& s, const std::string& message) {
  try {
    ws_.send(s.hdl, message, websocketpp::frame::opcode::text);
  } catch (const std::exception& e) {
    spdlog::debug("{}: send failed: {}", s.connId, e.what());
  }
}

void Server::sendError(Session& s, protocol::ErrorCode code, const std::string& message,
                       std::optional<nlohmann::json> detail) {
  enqueueTo(s, protocol::toJsonString(protocol::makeError(code, message, std::move(detail))),
            /*isState=*/false);
}

void Server::sendErrorAndClose(Session& s, protocol::ErrorCode code, const std::string& message,
                               std::optional<nlohmann::json> detail) {
  // Errors that terminate the connection go out directly (the queue may be
  // full and we are closing anyway).
  sendDirect(s, protocol::toJsonString(protocol::makeError(code, message, std::move(detail))));
  closeConnection(s, websocketpp::close::status::policy_violation, message);
}

void Server::closeConnection(Session& s, websocketpp::close::status::value code,
                             const std::string& reason) {
  s.closeReason = reason;
  std::error_code ec;
  ws_.close(s.hdl, code, reason, ec);
  if (ec) {
    spdlog::debug("{}: close failed: {}", s.connId, ec.message());
  }
}

void Server::broadcastToRoom(const std::string& roomId, const std::string& exceptSessionId,
                             const std::string& message, bool isState) {
  const Room* room = rooms_.findRoom(roomId);
  if (room == nullptr) {
    return;
  }
  for (const Member& m : room->members) {
    if (m.sessionId == exceptSessionId) {
      continue;  // never echo to the sender (ADR-004)
    }
    const auto it = hdlBySessionId_.find(m.sessionId);
    if (it == hdlBySessionId_.end()) {
      continue;
    }
    const auto sit = sessions_.find(it->second);
    if (sit == sessions_.end()) {
      continue;
    }
    enqueueTo(*sit->second, message, isState);
  }
}

void Server::broadcastLeave(Session& s, const std::string& reason) {
  broadcastToRoom(s.roomId, s.sessionId,
                  protocol::toJsonString(
                      protocol::makeLeaveBroadcast(s.sessionId, s.playerName, reason)),
                  /*isState=*/false);
}

void Server::enqueueTo(Session& s, std::string message, bool isState) {
  const EnqueueResult result =
      isState ? s.outbound.pushState(std::move(message)) : s.outbound.pushControl(std::move(message));
  switch (result) {
    case EnqueueResult::kPushed:
    case EnqueueResult::kDropped:
      break;
    case EnqueueResult::kOverflow:
      // Control message could not be queued: the consumer is behind. Mark
      // backpressure; the monitor disconnects after 5 s (ADR-004).
      if (!s.backpressureSince.has_value()) {
        s.backpressureSince = steadyNow();
        spdlog::warn("{}: outbound queue full (slow consumer)", s.connId);
      }
      return;
  }
  if (!s.drainPending) {
    s.drainPending = true;
    asio::post(*io_, [this, hdl = s.hdl] {
      const auto it = sessions_.find(hdl);
      if (it != sessions_.end()) {
        drain(*it->second);
      }
    });
  }
}

void Server::drain(Session& s) {
  s.drainPending = false;
  while (!s.outbound.empty()) {
    std::string message = s.outbound.popFront();
    try {
      ws_.send(s.hdl, message, websocketpp::frame::opcode::text);
    } catch (const std::exception& e) {
      // Connection vanished mid-drain; the onClose handler cleans up.
      spdlog::debug("{}: drain send failed: {}", s.connId, e.what());
      break;
    }
  }
  if (s.outbound.empty()) {
    s.backpressureSince.reset();
  }
}

void Server::armIdleTimer(Session& s) {
  if (!s.idleTimer) {
    s.idleTimer = std::make_shared<asio::steady_timer>(*io_);
  } else {
    std::error_code ec;
    s.idleTimer->cancel(ec);
  }
  s.idleTimer->expires_after(
      std::chrono::seconds(cfg_.idleTimeoutSeconds > 0 ? cfg_.idleTimeoutSeconds
                                                       : protocol::kIdleTimeoutSeconds));
  s.idleTimer->async_wait([this, hdl = s.hdl](const std::error_code& ec) {
    if (ec) {
      return;  // cancelled/re-armed
    }
    onIdleTimeout(std::move(hdl));
  });
}

void Server::onIdleTimeout(websocketpp::connection_hdl hdl) {
  const auto it = sessions_.find(hdl);
  if (it == sessions_.end()) {
    return;
  }
  Session& s = *it->second;
  spdlog::info("{}: idle timeout (no traffic for {}s), closing", s.connId,
               cfg_.idleTimeoutSeconds > 0 ? cfg_.idleTimeoutSeconds
                                           : protocol::kIdleTimeoutSeconds);
  closeConnection(s, websocketpp::close::status::going_away, "timeout");
}

void Server::startBackpressureMonitor() {
  backpressureTimer_ = std::make_shared<asio::steady_timer>(*io_);
  scheduleBackpressureCheck();
}

void Server::scheduleBackpressureCheck() {
  backpressureTimer_->expires_after(std::chrono::seconds(1));
  backpressureTimer_->async_wait([this](const std::error_code& ec) {
    if (ec || stopped_) {
      return;
    }
    checkBackpressure();
    scheduleBackpressureCheck();
  });
}

void Server::checkBackpressure() {
  const auto now = steadyNow();
  for (auto& [hdl, session] : sessions_) {
    Session& s = *session;
    if (s.backpressureSince.has_value() &&
        now - *s.backpressureSince > std::chrono::seconds(5)) {
      const auto heldForMs =
          std::chrono::duration_cast<std::chrono::milliseconds>(now - *s.backpressureSince)
              .count();
      spdlog::warn("{}: slow consumer (outbound queue full for {} ms > 5s), disconnecting",
                   s.connId, heldForMs);
      s.closeReason = "disconnect";  // onClose broadcasts leave
      std::error_code ec;
      ws_.close(hdl, websocketpp::close::status::going_away, "slow consumer", ec);
    }
  }
}

}  // namespace agenticrpg