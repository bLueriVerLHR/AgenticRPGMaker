// AgenticRPGMaker — loopback integration test [integration].
//
// Boots the real server in-process (single io_context) and drives real
// websocketpp clients over loopback: hello → welcome → two clients broadcast
// player_state to each other → chat → rate-limit behavior → leave → timeout.
// This is part of the required suite (ADR-005 / WAL §3) and runs headless.

#include <catch2/catch.hpp>

#include <asio/io_context.hpp>
#include <asio/ip/tcp.hpp>
#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_no_tls_client.hpp>

#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

#include "config.hpp"
#include "server.hpp"

namespace {

using ClientEndpoint = websocketpp::client<websocketpp::config::asio_client>;

// Reserves a free loopback TCP port by binding port 0, then releasing it.
std::uint16_t freePort() {
  asio::io_context io;
  asio::ip::tcp::acceptor acceptor(io);
  asio::ip::tcp::endpoint ep(asio::ip::tcp::v4(), 0);
  acceptor.open(ep.protocol());
  acceptor.set_option(asio::ip::tcp::acceptor::reuse_address(true));
  acceptor.bind(ep);
  return acceptor.local_endpoint().port();
}

// Minimal test WebSocket client: connects, records all received text messages,
// and offers blocking waits keyed on predicates over the received messages.
class TestWsClient {
 public:
  explicit TestWsClient(const std::string& uri) : uri_(uri) {}

  bool connect() {
    client_.init_asio(&io_);
    client_.clear_access_channels(websocketpp::log::alevel::all);
    client_.clear_error_channels(websocketpp::log::elevel::all);
    client_.set_open_handler([this](websocketpp::connection_hdl) {
      {
        std::lock_guard<std::mutex> lock(mu_);
        open_ = true;
      }
      cv_.notify_all();
    });
    client_.set_fail_handler([this](websocketpp::connection_hdl) {
      {
        std::lock_guard<std::mutex> lock(mu_);
        failed_ = true;
      }
      cv_.notify_all();
    });
    client_.set_close_handler([this](websocketpp::connection_hdl) {
      {
        std::lock_guard<std::mutex> lock(mu_);
        closed_ = true;
      }
      cv_.notify_all();
    });
    client_.set_message_handler([this](websocketpp::connection_hdl,
                                       ClientEndpoint::message_ptr msg) {
      {
        std::lock_guard<std::mutex> lock(mu_);
        messages_.push_back(msg->get_payload());
      }
      cv_.notify_all();
    });

    websocketpp::lib::error_code ec;
    auto con = client_.get_connection(uri_, ec);
    if (ec) {
      return false;
    }
    hdl_ = con->get_handle();
    client_.connect(con);
    thread_ = std::thread([this] { io_.run(); });
    return true;
  }

  // Sends a text message. websocketpp's send() is not safe to call from an
  // arbitrary thread while run() is active, so the send is posted onto the
  // client's io_context (sequenced with all connection operations) and the
  // caller blocks until it has completed.
  bool sendText(const std::string& payload) {
    websocketpp::lib::error_code ec;
    bool done = false;
    asio::post(io_, [this, payload, &ec, &done] {
      client_.send(hdl_, payload, websocketpp::frame::opcode::text, ec);
      {
        std::lock_guard<std::mutex> lock(mu_);
        done = true;
      }
      cv_.notify_all();
    });
    std::unique_lock<std::mutex> lock(mu_);
    cv_.wait(lock, [&] { return done; });
    return !ec;
  }

  // Waits up to `timeoutMs` for the predicate over the message list to hold.
  // The predicate must be pure over its argument (it runs while the client
  // mutex is held) — do not call locking accessors from inside it.
  template <typename Pred>
  bool waitFor(Pred pred, int timeoutMs = 5000) {
    std::unique_lock<std::mutex> lock(mu_);
    return cv_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [&] {
      return pred(messages_);
    });
  }

  bool waitUntilOpen(int timeoutMs = 5000) {
    std::unique_lock<std::mutex> lock(mu_);
    return cv_.wait_for(lock, std::chrono::milliseconds(timeoutMs),
                        [&] { return open_ && !closed_ && !failed_; });
  }

  bool waitUntilClosed(int timeoutMs = 5000) {
    std::unique_lock<std::mutex> lock(mu_);
    return cv_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [&] { return closed_; });
  }

  bool isOpen() {
    std::lock_guard<std::mutex> lock(mu_);
    return open_ && !closed_ && !failed_;
  }

  bool isClosed() {
    std::lock_guard<std::mutex> lock(mu_);
    return closed_;
  }

  bool failed() {
    std::lock_guard<std::mutex> lock(mu_);
    return failed_;
  }

  std::vector<std::string> drainMessages() {
    std::lock_guard<std::mutex> lock(mu_);
    std::vector<std::string> out = std::move(messages_);
    messages_.clear();
    return out;
  }

  void close() {
    websocketpp::lib::error_code ec;
    client_.close(hdl_, websocketpp::close::status::normal, "test done", ec);
  }

  ~TestWsClient() {
    // Stopping the io_context from any thread ends the run loop; the
    // websocketpp transport cleans up its connections on destruction.
    io_.stop();
    if (thread_.joinable()) {
      thread_.join();
    }
  }

 private:
  std::string uri_;
  asio::io_context io_;
  ClientEndpoint client_;
  websocketpp::connection_hdl hdl_;
  std::thread thread_;
  std::mutex mu_;
  std::condition_variable cv_;
  std::vector<std::string> messages_;
  bool open_ = false;
  bool closed_ = false;
  bool failed_ = false;
};

// Helper: parse every message; returns only those of the given type.
std::vector<nlohmann::json> byType(const std::vector<std::string>& raw, const char* type) {
  std::vector<nlohmann::json> out;
  for (const std::string& m : raw) {
    try {
      nlohmann::json j = nlohmann::json::parse(m);
      if (j.value("type", "") == type) {
        out.push_back(std::move(j));
      }
    } catch (...) {
    }
  }
  return out;
}

// RAII server that boots on a background thread and shuts down cleanly.
struct RunningServer {
  explicit RunningServer(const agenticrpg::ServerConfig& cfg) : server(cfg) {
    // Tests run with debug logging so protocol timing/malformed diagnostics
    // are visible; chat text is never logged at the default info level.
    spdlog::set_level(spdlog::level::debug);
    server.start();
    server.runInBackground();
  }
  ~RunningServer() { server.stop(); }
  agenticrpg::Server server;
};

}  // namespace

TEST_CASE("integration: hello → welcome → relay player_state/chat → leave",
          "[integration]") {
  const std::uint16_t port = freePort();
  agenticrpg::ServerConfig cfg;
  cfg.port = port;
  cfg.idleTimeoutSeconds = 2;  // short idle timeout to exercise timeout path
  RunningServer running(cfg);

  const std::string base = "ws://127.0.0.1:" + std::to_string(port) + "/ws";

  TestWsClient aria(base + "?aria");
  TestWsClient kibo(base + "?kibo");
  REQUIRE(aria.connect());
  REQUIRE(kibo.connect());
  REQUIRE(aria.waitUntilOpen());
  REQUIRE(kibo.waitUntilOpen());

  // Aria joins first; her welcome lists only herself.
  REQUIRE(aria.sendText(R"({"v":1,"type":"hello","seq":1,"payload":{"playerName":"Aria","roomId":"room-alpha"}})"));
  REQUIRE(aria.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "welcome").empty();
  }));
  auto ariaWelcomes = byType(aria.drainMessages(), "welcome");
  REQUIRE(ariaWelcomes.size() == 1);
  REQUIRE(ariaWelcomes[0]["payload"]["roomId"] == "room-alpha");
  REQUIRE(ariaWelcomes[0]["payload"]["sessionId"].is_string());
  REQUIRE(ariaWelcomes[0]["payload"]["serverTimeMs"].is_number());
  REQUIRE(ariaWelcomes[0]["payload"]["players"].size() == 1);
  const std::string ariaSession = ariaWelcomes[0]["payload"]["sessionId"].get<std::string>();

  // Kibo joins second; his welcome includes both players.
  REQUIRE(kibo.sendText(R"({"v":1,"type":"hello","seq":1,"payload":{"playerName":"Kibo","roomId":"room-alpha"}})"));
  REQUIRE(kibo.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "welcome").empty();
  }));
  auto kiboWelcomes = byType(kibo.drainMessages(), "welcome");
  REQUIRE(kiboWelcomes.size() == 1);
  REQUIRE(kiboWelcomes[0]["payload"]["players"].size() == 2);

  // Aria broadcasts a player_state; Kibo receives it with sessionId added.
  const std::string psMsg =
      R"({"v":1,"type":"player_state","seq":2,"payload":{"state":{"x":16.5,"y":12.0,"direction":"down"},"clientTimeMs":100}})";
  std::fprintf(stderr, "[test] psMsg literal size=%zu\n", psMsg.size());
  REQUIRE(aria.sendText(psMsg));
  REQUIRE(kibo.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "player_state").empty();
  }));
  auto kiboStates = byType(kibo.drainMessages(), "player_state");
  REQUIRE(kiboStates.size() == 1);
  REQUIRE(kiboStates[0]["payload"]["sessionId"] == ariaSession);
  REQUIRE(kiboStates[0]["payload"]["state"]["x"] == 16.5);
  REQUIRE(kiboStates[0]["payload"]["serverTimeMs"].is_number());
  // The sender is never echoed its own state.
  REQUIRE(byType(aria.drainMessages(), "player_state").empty());

  // Kibo sends chat; Aria receives it (text is not logged by the server).
  REQUIRE(kibo.sendText(R"({"v":1,"type":"chat","seq":2,"payload":{"text":"hello Aria!"}})"));
  REQUIRE(aria.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "chat").empty();
  }));
  auto ariaChats = byType(aria.drainMessages(), "chat");
  REQUIRE(ariaChats.size() == 1);
  REQUIRE(ariaChats[0]["payload"]["text"] == "hello Aria!");
  REQUIRE(ariaChats[0]["payload"]["playerName"] == "Kibo");
  REQUIRE(ariaChats[0]["payload"]["serverTimeMs"].is_number());

  // Aria leaves explicitly; Kibo gets the S->C leave, then Aria closes.
  REQUIRE(aria.sendText(R"({"v":1,"type":"leave","seq":3,"payload":{"reason":"user_quit"}})"));
  REQUIRE(kibo.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "leave").empty();
  }));
  auto kiboLeaves = byType(kibo.drainMessages(), "leave");
  REQUIRE(kiboLeaves.size() == 1);
  REQUIRE(kiboLeaves[0]["payload"]["sessionId"] == ariaSession);
  REQUIRE(kiboLeaves[0]["payload"]["reason"] == "user_quit");
  REQUIRE(aria.waitUntilClosed(5000));
}

TEST_CASE("integration: rate limiting coalesces player_state and errors on abuse",
          "[integration]") {
  const std::uint16_t port = freePort();
  agenticrpg::ServerConfig cfg;
  cfg.port = port;
  cfg.idleTimeoutSeconds = 10;
  RunningServer running(cfg);

  const std::string base = "ws://127.0.0.1:" + std::to_string(port) + "/ws";
  TestWsClient sender(base + "?sender");
  TestWsClient receiver(base + "?receiver");
  REQUIRE(sender.connect());
  REQUIRE(receiver.connect());
  REQUIRE(sender.waitUntilOpen());
  REQUIRE(receiver.waitUntilOpen());

  const std::string helloSender =
      R"({"v":1,"type":"hello","payload":{"playerName":"Sender","roomId":"rl"}})";
  const std::string helloReceiver =
      R"({"v":1,"type":"hello","payload":{"playerName":"Receiver","roomId":"rl"}})";
  REQUIRE(sender.sendText(helloSender));
  REQUIRE(receiver.sendText(helloReceiver));
  REQUIRE(sender.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "welcome").empty();
  }));
  REQUIRE(receiver.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "welcome").empty();
  }));
  sender.drainMessages();
  receiver.drainMessages();

  // Burst far beyond 10 Hz (burst 15). After 45 dropped updates the server
  // replies rate_limited; the receiver sees far fewer than sent (coalesced).
  for (int i = 0; i < 60; ++i) {
    const std::string payload =
        "{\"v\":1,\"type\":\"player_state\",\"payload\":{\"state\":{\"x\":" +
        std::to_string(i) +
        ",\"y\":0},\"clientTimeMs\":" + std::to_string(i) + "}}";
    REQUIRE(sender.sendText(payload));
  }
  REQUIRE(sender.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "error").empty();
  }));
  auto senderErrors = byType(sender.drainMessages(), "error");
  REQUIRE(senderErrors.size() >= 1);
  bool sawRateLimited = false;
  for (const auto& e : senderErrors) {
    if (e["payload"].value("code", "") == "rate_limited") {
      sawRateLimited = true;
    }
  }
  REQUIRE(sawRateLimited);

  // The receiver must not have received all 60 broadcasts.
  auto receiverStates = byType(receiver.drainMessages(), "player_state");
  REQUIRE(receiverStates.size() < 60);

  // Chat: burst of 3 -> at most 2 relayed, third triggers rate_limited.
  REQUIRE(sender.sendText(R"({"v":1,"type":"chat","payload":{"text":"one"}})"));
  REQUIRE(sender.sendText(R"({"v":1,"type":"chat","payload":{"text":"two"}})"));
  REQUIRE(sender.sendText(R"({"v":1,"type":"chat","payload":{"text":"three"}})"));
  REQUIRE(sender.waitFor([&](const std::vector<std::string>& msgs) {
    bool found = false;
    for (const auto& e : byType(msgs, "error")) {
      if (e["payload"].value("code", "") == "rate_limited") {
        found = true;
      }
    }
    return found;
  }));
  auto receiverChats = byType(receiver.drainMessages(), "chat");
  REQUIRE(receiverChats.size() <= 2);
}

TEST_CASE("integration: protocol errors — version mismatch and name_taken",
          "[integration]") {
  const std::uint16_t port = freePort();
  agenticrpg::ServerConfig cfg;
  cfg.port = port;
  cfg.idleTimeoutSeconds = 10;
  RunningServer running(cfg);

  const std::string base = "ws://127.0.0.1:" + std::to_string(port) + "/ws";

  // Wrong protocol version → protocol_version_mismatch error, then close.
  TestWsClient badVersion(base + "?v");
  REQUIRE(badVersion.connect());
  REQUIRE(badVersion.waitUntilOpen());
  const std::string badHello =
      R"({"v":2,"type":"hello","payload":{"playerName":"X","roomId":"r"}})";
  REQUIRE(badVersion.sendText(badHello));
  REQUIRE(badVersion.waitFor([&](const std::vector<std::string>& msgs) {
    const auto errors = byType(msgs, "error");
    return !errors.empty() &&
           errors[0]["payload"].value("code", "") == "protocol_version_mismatch";
  }));
  REQUIRE(badVersion.waitUntilClosed());

  // Duplicate player name in one room → name_taken error.
  TestWsClient a(base + "?a");
  TestWsClient b(base + "?b");
  REQUIRE(a.connect());
  REQUIRE(b.connect());
  REQUIRE(a.waitUntilOpen());
  REQUIRE(b.waitUntilOpen());
  const std::string dupHello =
      R"({"v":1,"type":"hello","payload":{"playerName":"Dup","roomId":"r2"}})";
  REQUIRE(a.sendText(dupHello));
  REQUIRE(a.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "welcome").empty();
  }));
  REQUIRE(b.sendText(dupHello));
  REQUIRE(b.waitFor([&](const std::vector<std::string>& msgs) {
    const auto errors = byType(msgs, "error");
    return !errors.empty() && errors[0]["payload"].value("code", "") == "name_taken";
  }));
  REQUIRE(b.waitUntilClosed());
}

TEST_CASE("integration: idle timeout closes a silent connection as leave(timeout)",
          "[integration]") {
  const std::uint16_t port = freePort();
  agenticrpg::ServerConfig cfg;
  cfg.port = port;
  cfg.idleTimeoutSeconds = 2;  // keep the test fast
  RunningServer running(cfg);

  const std::string base = "ws://127.0.0.1:" + std::to_string(port) + "/ws";
  TestWsClient watcher(base + "?watcher");
  TestWsClient silent(base + "?silent");
  REQUIRE(watcher.connect());
  REQUIRE(silent.connect());
  REQUIRE(watcher.waitUntilOpen());
  REQUIRE(silent.waitUntilOpen());

  const std::string helloWatcher =
      R"({"v":1,"type":"hello","payload":{"playerName":"Watcher","roomId":"rt"}})";
  const std::string helloSilent =
      R"({"v":1,"type":"hello","payload":{"playerName":"Silent","roomId":"rt"}})";
  REQUIRE(watcher.sendText(helloWatcher));
  REQUIRE(silent.sendText(helloSilent));
  REQUIRE(watcher.waitFor([&](const std::vector<std::string>& msgs) {
    return !byType(msgs, "welcome").empty();
  }));
  watcher.drainMessages();

  // The watcher must keep itself alive while the silent client goes quiet:
  // per ADR-004 clients heartbeat to avoid the idle timeout, so the watcher
  // pings from a helper thread (sendText is thread-safe via the io_context).
  std::atomic<bool> stopPing{false};
  std::thread pinger([&] {
    while (!stopPing.load()) {
      watcher.sendText(R"({"v":1,"type":"ping","payload":{}})");
      std::this_thread::sleep_for(std::chrono::milliseconds(400));
    }
  });

  // The silent client sends nothing else; after the idle timeout the watcher
  // receives leave(timeout) and the silent client is closed.
  const bool sawLeave = watcher.waitFor([&](const std::vector<std::string>& msgs) {
    const auto leaves = byType(msgs, "leave");
    return !leaves.empty() && leaves[0]["payload"].value("reason", "") == "timeout";
  }, 8000);
  stopPing.store(true);
  pinger.join();
  REQUIRE(sawLeave);
  REQUIRE(silent.waitUntilClosed(8000));
}

TEST_CASE("integration: HTTP static serving over the wire", "[integration]") {
  // Boot the real server and issue real TCP GET requests (this exercises the
  // websocketpp HTTP handler path incl. defer_http_response, MIME mapping and
  // path canonicalization end to end).
  const std::uint16_t port = freePort();

  // Create a throwaway www/editor tree for the server to serve.
  const auto wwwRoot = std::filesystem::temp_directory_path() / "agenticrpg-http-it-www";
  const auto editorRoot = std::filesystem::temp_directory_path() / "agenticrpg-http-it-editor";
  std::filesystem::create_directories(wwwRoot / "js");
  std::filesystem::create_directories(editorRoot);
  {
    std::ofstream(wwwRoot / "index.html") << "<html>game</html>";
    std::ofstream(wwwRoot / "js" / "app.js") << "console.log(1);";
    std::ofstream(editorRoot / "index.html") << "<html>editor</html>";
  }

  agenticrpg::ServerConfig cfg;
  cfg.port = port;
  cfg.idleTimeoutSeconds = 10;
  cfg.wwwRoot = wwwRoot.string();
  cfg.editorRoot = editorRoot.string();
  RunningServer running(cfg);

  const auto httpGet = [&](const std::string& path, int timeoutMs = 5000) {
    // Minimal blocking HTTP/1.1 GET over a raw TCP socket.
    asio::io_context io;
    asio::ip::tcp::socket sock(io);
    asio::ip::tcp::endpoint ep(asio::ip::tcp::v4(), port);
    sock.connect(ep);
    const std::string req = "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    asio::write(sock, asio::buffer(req));
    std::string response;
    std::array<char, 1024> buf{};
    asio::error_code ec;
    while (true) {
      const std::size_t n = asio::read(sock, asio::buffer(buf), asio::transfer_at_least(1), ec);
      response.append(buf.data(), n);
      if (ec) {
        break;  // eof / connection closed
      }
    }
    return response;
  };

  const auto r1 = httpGet("/");
  REQUIRE(r1.find("200 OK") != std::string::npos);
  REQUIRE(r1.find("text/html") != std::string::npos);
  REQUIRE(r1.find("<html>game</html>") != std::string::npos);

  const auto r2 = httpGet("/js/app.js");
  REQUIRE(r2.find("200 OK") != std::string::npos);
  REQUIRE(r2.find("text/javascript") != std::string::npos);
  REQUIRE(r2.find("console.log(1);") != std::string::npos);

  const auto r3 = httpGet("/editor/");
  REQUIRE(r3.find("200 OK") != std::string::npos);
  REQUIRE(r3.find("<html>editor</html>") != std::string::npos);

  // Traversal is rejected (never reaches the file system).
  const auto r4 = httpGet("/../etc/passwd");
  const bool traversalRejected = r4.find("400 Bad Request") != std::string::npos ||
                                 r4.find("404 Not Found") != std::string::npos;
  REQUIRE(traversalRejected);

  // Missing files are 404.
  const auto r5 = httpGet("/missing.txt");
  REQUIRE(r5.find("404 Not Found") != std::string::npos);

  std::filesystem::remove_all(wwwRoot);
  std::filesystem::remove_all(editorRoot);
}
