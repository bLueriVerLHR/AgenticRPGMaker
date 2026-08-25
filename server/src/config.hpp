// AgenticRPGMaker — server configuration (CLI + environment).
//
// ADR-005 / RQ3: config is runtime-configurable via CLI flags and the
// AGENTICRPG_PORT / AGENTICRPG_LOG_LEVEL environment variables; the log level
// is never hard-coded (03-wal-process.md §2).

#ifndef AGENTICRPG_SERVER_CONFIG_HPP
#define AGENTICRPG_SERVER_CONFIG_HPP

#include <spdlog/spdlog.h>

#include <cstdint>
#include <iosfwd>
#include <string>

namespace agenticrpg {

struct ServerConfig {
  std::string wwwRoot = "www";
  std::string editorRoot = "editor";
  std::uint16_t port = 8080;
  std::string logLevel = "info";
  std::uint16_t maxPlayersPerRoom = 16;
  // Internal (not CLI-exposed) test/ops seam: idle timeout before a silent
  // connection is closed as leave(timeout). Default 60 s per ADR-004.
  int idleTimeoutSeconds = 60;
};

// Parses argv into a ServerConfig. Env overrides (AGENTICRPG_PORT,
// AGENTICRPG_LOG_LEVEL) apply first, then CLI flags on top.
// Throws std::runtime_error on unknown flags / invalid values.
ServerConfig parseArgs(int argc, char** argv);

// Prints usage to the given stream (--help).
void printUsage(std::ostream& out);

// Maps a config log-level string to the spdlog level; throws on unknown.
spdlog::level::level_enum parseLogLevel(const std::string& raw);

}  // namespace agenticrpg

#endif  // AGENTICRPG_SERVER_CONFIG_HPP