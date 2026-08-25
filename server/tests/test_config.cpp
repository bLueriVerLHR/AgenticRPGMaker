// AgenticRPGMaker — config/CLI unit tests.
//
// Covers ADR-005 config: defaults, AGENTICRPG_PORT / AGENTICRPG_LOG_LEVEL env
// overrides, CLI flags, invalid-value rejection and the max-players-per-room
// flag.

#include <catch2/catch.hpp>

#include <cstdlib>
#include <vector>

#include "config.hpp"

namespace {

// Builds a mutable argv buffer from strings (argv[0] = program name).
std::vector<char*> makeArgv(std::vector<std::string>& storage,
                            const std::vector<std::string>& args) {
  storage.push_back("agenticrpg-server");
  for (const std::string& a : args) {
    storage.push_back(a);
  }
  std::vector<char*> argv;
  argv.reserve(storage.size());
  for (std::string& s : storage) {
    argv.push_back(s.data());
  }
  return argv;
}

struct EnvGuard {
  EnvGuard() {
    port_ = std::getenv("AGENTICRPG_PORT");
    level_ = std::getenv("AGENTICRPG_LOG_LEVEL");
    if (port_) savedPort_ = port_;
    if (level_) savedLevel_ = level_;
  }
  ~EnvGuard() {
    if (savedPort_.empty()) {
      unsetenv("AGENTICRPG_PORT");
    } else {
      setenv("AGENTICRPG_PORT", savedPort_.c_str(), 1);
    }
    if (savedLevel_.empty()) {
      unsetenv("AGENTICRPG_LOG_LEVEL");
    } else {
      setenv("AGENTICRPG_LOG_LEVEL", savedLevel_.c_str(), 1);
    }
  }
  const char* port_ = nullptr;
  const char* level_ = nullptr;
  std::string savedPort_;
  std::string savedLevel_;
};

}  // namespace

TEST_CASE("config: defaults", "[unit][config]") {
  EnvGuard env;  // isolate from ambient environment
  unsetenv("AGENTICRPG_PORT");
  unsetenv("AGENTICRPG_LOG_LEVEL");
  std::vector<std::string> storage;
  std::vector<char*> argv = makeArgv(storage, {});
  const agenticrpg::ServerConfig cfg = agenticrpg::parseArgs(static_cast<int>(argv.size()), argv.data());
  REQUIRE(cfg.port == 8080);
  REQUIRE(cfg.wwwRoot == "www");
  REQUIRE(cfg.editorRoot == "editor");
  REQUIRE(cfg.logLevel == "info");
  REQUIRE(cfg.maxPlayersPerRoom == 16);
}

TEST_CASE("config: CLI flags override defaults", "[unit][config]") {
  EnvGuard env;
  unsetenv("AGENTICRPG_PORT");
  unsetenv("AGENTICRPG_LOG_LEVEL");
  std::vector<std::string> storage;
  std::vector<char*> argv =
      makeArgv(storage, {"--port", "9000", "--www-root", "site", "--editor-root", "studio",
                         "--log-level", "debug", "--max-players-per-room", "4"});
  const agenticrpg::ServerConfig cfg = agenticrpg::parseArgs(static_cast<int>(argv.size()), argv.data());
  REQUIRE(cfg.port == 9000);
  REQUIRE(cfg.wwwRoot == "site");
  REQUIRE(cfg.editorRoot == "studio");
  REQUIRE(cfg.logLevel == "debug");
  REQUIRE(cfg.maxPlayersPerRoom == 4);
}

TEST_CASE("config: environment overrides defaults, CLI wins over env", "[unit][config]") {
  EnvGuard env;
  setenv("AGENTICRPG_PORT", "7070", 1);
  setenv("AGENTICRPG_LOG_LEVEL", "warn", 1);

  std::vector<std::string> storage;
  std::vector<char*> argv = makeArgv(storage, {});
  const agenticrpg::ServerConfig cfgEnv =
      agenticrpg::parseArgs(static_cast<int>(argv.size()), argv.data());
  REQUIRE(cfgEnv.port == 7070);
  REQUIRE(cfgEnv.logLevel == "warn");

  std::vector<std::string> storage2;
  std::vector<char*> argv2 = makeArgv(storage2, {"--port", "9090", "--log-level", "trace"});
  const agenticrpg::ServerConfig cfgCli =
      agenticrpg::parseArgs(static_cast<int>(argv2.size()), argv2.data());
  REQUIRE(cfgCli.port == 9090);
  REQUIRE(cfgCli.logLevel == "trace");
}

TEST_CASE("config: invalid values are rejected", "[unit][config]") {
  EnvGuard env;
  unsetenv("AGENTICRPG_PORT");
  unsetenv("AGENTICRPG_LOG_LEVEL");

  const std::vector<std::vector<std::string>> bad = {
      {"--port", "not-a-port"}, {"--port", "0"},          {"--port", "70000"},
      {"--log-level", "verbose"}, {"--bogus"},            {"--port"},  // missing value
      {"--max-players-per-room", "x"}, {"--max-players-per-room", "0"},
  };
  for (const auto& args : bad) {
    std::vector<std::string> storage;
    std::vector<char*> argv = makeArgv(storage, args);
    REQUIRE_THROWS_AS(agenticrpg::parseArgs(static_cast<int>(argv.size()), argv.data()),
                      std::runtime_error);
  }
}

TEST_CASE("config: log level mapping", "[unit][config]") {
  REQUIRE(agenticrpg::parseLogLevel("info") == spdlog::level::info);
  REQUIRE(agenticrpg::parseLogLevel("DEBUG") == spdlog::level::debug);
  REQUIRE(agenticrpg::parseLogLevel("warn") == spdlog::level::warn);
  REQUIRE(agenticrpg::parseLogLevel("error") == spdlog::level::err);
  REQUIRE(agenticrpg::parseLogLevel("critical") == spdlog::level::critical);
  REQUIRE(agenticrpg::parseLogLevel("trace") == spdlog::level::trace);
  REQUIRE_THROWS_AS(agenticrpg::parseLogLevel("loud"), std::runtime_error);
}
