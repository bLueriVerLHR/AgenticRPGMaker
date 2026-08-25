// AgenticRPGMaker — relay/state-sync server (ADR-005 / RQ3).
//
// One process, one io_context (single-threaded for MVP): custom HTTP static
// serving (www + editor) and the WebSocket relay endpoint /ws on the same
// port. Implements the ADR-004 protocol v1: hello/welcome handshake, room
// registry with last-known player_state, player_state/chat/leave relay,
// ping/pong heartbeat, idle timeout, per-client rate limiting and bounded
// outbound queues with slow-consumer disconnect.

#ifndef AGENTICRPG_SERVER_SERVER_HPP
#define AGENTICRPG_SERVER_SERVER_HPP

#include <asio/io_context.hpp>
#include <asio/steady_timer.hpp>
// No TLS/WSS in MVP (ADR-005 Negative): the no_tls config defines
// websocketpp::config::asio without pulling in OpenSSL.
#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <thread>

#include "config.hpp"
#include "http_static.hpp"
#include "outbound_queue.hpp"
#include "protocol.hpp"
#include "rate_limiter.hpp"
#include "room_registry.hpp"

namespace agenticrpg {

class Server {
 public:
  using WsEndpoint = websocketpp::server<websocketpp::config::asio>;
  using MessagePtr = WsEndpoint::message_ptr;

  explicit Server(ServerConfig cfg);

  // Initializes asio, installs handlers, binds and starts accepting.
  // Throws std::runtime_error on listen/init failure.
  void start();

  // Runs the io_context (blocking). Call after start().
  void run();

  // Runs the io_context on a background thread (tests / tooling).
  void runInBackground();

  // Stops the io_context and joins the background thread if running.
  void stop();

  const ServerConfig& config() const { return cfg_; }

 private:
  struct Session {
    websocketpp::connection_hdl hdl;
    std::string connId;  // server-side connection id (logs)
    std::string sessionId;  // protocol session id (assigned on join)
    bool helloDone = false;
    std::string playerName;
    std::string roomId;
    std::optional<std::string> projectId;
    bool left = false;            // leave already broadcast
    std::string closeReason;      // set before server-initiated close
    bool unknownTypeReported = false;
    std::size_t consecutiveErrors = 0;      // malformed/oversize → close
    std::size_t stateRateLimitDrops = 0;    // since last error (abuse window)
    std::size_t stateRateLimitErrors = 0;   // → disconnect after threshold
    std::size_t chatRateLimitHits = 0;      // → disconnect after threshold
    RateLimiter limiter;
    OutboundQueue outbound{protocol::kOutboundQueueCap};
    bool drainPending = false;
    std::optional<std::chrono::steady_clock::time_point> backpressureSince;
    std::shared_ptr<asio::steady_timer> idleTimer;
  };

  // ---- websocketpp handlers -------------------------------------------------
  void onOpen(websocketpp::connection_hdl hdl);
  void onMessage(websocketpp::connection_hdl hdl, MessagePtr msg);
  void onClose(websocketpp::connection_hdl hdl);
  void onFail(websocketpp::connection_hdl hdl);
  void onHttp(websocketpp::connection_hdl hdl);

  // ---- protocol dispatch ----------------------------------------------------
  void handleHello(Session& s, const protocol::ParsedMessage& parsed);
  void handlePlayerState(Session& s, const protocol::ParsedMessage& parsed);
  void handleChat(Session& s, const protocol::ParsedMessage& parsed);
  void handleLeave(Session& s, const protocol::ParsedMessage& parsed);
  void handlePing(Session& s, const protocol::ParsedMessage& parsed);

  // ---- helpers --------------------------------------------------------------
  void sendDirect(Session& s, const std::string& message);
  void sendError(Session& s, protocol::ErrorCode code, const std::string& message,
                 std::optional<nlohmann::json> detail = std::nullopt);
  void sendErrorAndClose(Session& s, protocol::ErrorCode code, const std::string& message,
                         std::optional<nlohmann::json> detail = std::nullopt);
  void closeConnection(Session& s, websocketpp::close::status::value code,
                       const std::string& reason);

  void broadcastToRoom(const std::string& roomId, const std::string& exceptSessionId,
                       const std::string& message, bool isState);
  void broadcastLeave(Session& s, const std::string& reason);
  void enqueueTo(Session& s, std::string message, bool isState);
  void drain(Session& s);

  void armIdleTimer(Session& s);
  void onIdleTimeout(websocketpp::connection_hdl hdl);
  void startBackpressureMonitor();
  void scheduleBackpressureCheck();
  void checkBackpressure();

  std::string remoteOf(websocketpp::connection_hdl hdl);

  ServerConfig cfg_;
  // Declared BEFORE ws_ so the websocketpp endpoint is destroyed before the
  // io_context it runs on (member destruction is reverse declaration order).
  std::unique_ptr<asio::io_context> io_;
  WsEndpoint ws_;
  RoomRegistry rooms_;
  std::map<websocketpp::connection_hdl, std::shared_ptr<Session>,
           std::owner_less<websocketpp::connection_hdl>>
      sessions_;
  std::map<std::string, websocketpp::connection_hdl> hdlBySessionId_;
  std::shared_ptr<asio::steady_timer> backpressureTimer_;
  std::uint64_t nextConnId_ = 1;
  std::thread thread_;
  std::atomic<bool> stopped_{false};
};

}  // namespace agenticrpg

#endif  // AGENTICRPG_SERVER_SERVER_HPP