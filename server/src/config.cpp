// AgenticRPGMaker — server configuration (CLI + environment) implementation.

#include "config.hpp"

#include <spdlog/spdlog.h>

#include <charconv>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace agenticrpg {
namespace {

std::string toLower(std::string_view value) {
  std::string out;
  out.reserve(value.size());
  for (const char c : value) {
    out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  }
  return out;
}

// Bounded integer parse via std::from_chars: no exceptions on bad input.
std::uint16_t parseU16(std::string_view raw, const std::string& flag, std::uint16_t minValue) {
  std::uint16_t value = 0;
  const auto [ptr, ec] = std::from_chars(raw.data(), raw.data() + raw.size(), value);
  if (ec != std::errc{} || ptr != raw.data() + raw.size() || value < minValue) {
    throw std::runtime_error("invalid " + flag + " value '" + std::string(raw) + "'");
  }
  return value;
}

std::string requireNext(const std::vector<std::string>& args, std::size_t& i, const std::string& flag) {
  if (i + 1 >= args.size()) {
    throw std::runtime_error("missing value for " + flag);
  }
  return args[++i];
}

}  // namespace

void printUsage(std::ostream& out) {
  out << "Usage: agenticrpg-server [options]\n"
      << "\n"
      << "AgenticRPGMaker relay/state-sync server (ADR-005 / RQ3). Serves the\n"
      << "portable www package and the editor build over HTTP and hosts the\n"
      << "multiplayer WebSocket relay on the same port.\n"
      << "\n"
      << "Options:\n"
      << "  --port <port>             Listening port (default 8080; env AGENTICRPG_PORT)\n"
      << "  --www-root <dir>          Directory of the portable www package to serve (default \"www\")\n"
      << "  --editor-root <dir>       Directory of the editor build to serve under /editor (default \"editor\")\n"
      << "  --log-level <level>       trace|debug|info|warn|error|critical (default info; env AGENTICRPG_LOG_LEVEL)\n"
      << "  --max-players-per-room <n> Room player cap (default 16)\n"
      << "  -h, --help                Show this help and exit\n";
}

ServerConfig parseArgs(int argc, char** argv) {
  ServerConfig cfg;

  // Environment fallbacks (ADR-005: level/config runtime-configurable).
  if (const char* envPort = std::getenv("AGENTICRPG_PORT"); envPort != nullptr) {
    cfg.port = parseU16(envPort, "AGENTICRPG_PORT", 1);
  }
  if (const char* envLevel = std::getenv("AGENTICRPG_LOG_LEVEL"); envLevel != nullptr) {
    cfg.logLevel = envLevel;
  }

  const std::vector<std::string> args(argv + 1, argv + argc);
  for (std::size_t i = 0; i < args.size(); ++i) {
    const std::string& arg = args[i];
    if (arg == "-h" || arg == "--help") {
      printUsage(std::cout);
      std::exit(0);
    } else if (arg == "--port") {
      cfg.port = parseU16(requireNext(args, i, arg), "--port", 1);
    } else if (arg == "--www-root") {
      cfg.wwwRoot = requireNext(args, i, arg);
    } else if (arg == "--editor-root") {
      cfg.editorRoot = requireNext(args, i, arg);
    } else if (arg == "--log-level") {
      cfg.logLevel = requireNext(args, i, arg);
    } else if (arg == "--max-players-per-room") {
      cfg.maxPlayersPerRoom = parseU16(requireNext(args, i, arg), "--max-players-per-room", 1);
    } else {
      throw std::runtime_error("unknown argument '" + arg + "' (see --help)");
    }
  }

  // Validate the resolved log level up front (covers CLI and env) so a bad
  // value fails fast at parse time instead of at server start.
  parseLogLevel(cfg.logLevel);
  return cfg;
}

spdlog::level::level_enum parseLogLevel(const std::string& raw) {
  const std::string level = toLower(raw);
  if (level == "trace") return spdlog::level::trace;
  if (level == "debug") return spdlog::level::debug;
  if (level == "info") return spdlog::level::info;
  if (level == "warn") return spdlog::level::warn;
  if (level == "error") return spdlog::level::err;
  if (level == "critical") return spdlog::level::critical;
  throw std::runtime_error("invalid log level '" + raw +
                           "' (expected trace|debug|info|warn|error|critical)");
}

}  // namespace agenticrpg