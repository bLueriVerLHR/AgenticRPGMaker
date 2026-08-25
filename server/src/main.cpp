// AgenticRPGMaker — C++ server entry point (P0 scaffold).
//
// ADR-005 / RQ3: one C++20 Linux executable that will serve the portable www
// package, the editor build, and host the multiplayer WebSocket relay. P0
// provides only the configuration parsing and the spdlog logging seam; HTTP
// static serving and the WebSocket relay arrive in P3.
//
// Logging policy (03-wal-process.md §2): lifecycle/config at info, protocol
// errors at warn/error, per-message timing at debug; level is
// runtime-configurable via --log-level or the AGENTICRPG_LOG_LEVEL env var and
// never hard-coded. Secrets are never logged.

#include <spdlog/spdlog.h>

#include <charconv>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace {

struct ServerConfig {
  std::uint16_t port = 8080;
  std::string wwwRoot = "www";
  std::string logLevel = "info";
};

void printUsage(std::ostream& out) {
  out << "Usage: agenticrpg-server [options]\n"
      << "Options:\n"
      << "  --port <port>        Listening HTTP/WebSocket port (default 8080; env AGENTICRPG_PORT)\n"
      << "  --www-root <dir>     Directory of the portable www package to serve (default \"www\")\n"
      << "  --log-level <level>  trace|debug|info|warn|error|critical (default info; env AGENTICRPG_LOG_LEVEL)\n"
      << "  -h, --help           Show this help and exit\n";
}

std::string toLower(std::string_view value) {
  std::string out;
  out.reserve(value.size());
  for (const char c : value) {
    out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  }
  return out;
}

// Bounded integer parse via std::from_chars: no exceptions on bad input.
std::uint16_t parsePort(std::string_view raw) {
  std::uint16_t port = 0;
  const auto [ptr, ec] = std::from_chars(raw.data(), raw.data() + raw.size(), port);
  if (ec != std::errc{} || ptr != raw.data() + raw.size() || port == 0) {
    throw std::runtime_error("invalid --port value '" + std::string(raw) + "' (expected 1-65535)");
  }
  return port;
}

spdlog::level::level_enum parseLogLevel(std::string_view raw) {
  const std::string level = toLower(raw);
  if (level == "trace") return spdlog::level::trace;
  if (level == "debug") return spdlog::level::debug;
  if (level == "info") return spdlog::level::info;
  if (level == "warn") return spdlog::level::warn;
  if (level == "error") return spdlog::level::err;
  if (level == "critical") return spdlog::level::critical;
  throw std::runtime_error("invalid --log-level '" + std::string(raw) +
                           "' (expected trace|debug|info|warn|error|critical)");
}

// Reads a CLI flag value, requiring the next argument to exist.
std::string requireNext(const std::vector<std::string>& args, std::size_t& i, const std::string& flag) {
  if (i + 1 >= args.size()) {
    throw std::runtime_error("missing value for " + flag);
  }
  return args[++i];
}

ServerConfig parseArgs(int argc, char** argv) {
  ServerConfig cfg;

  // Environment fallbacks (ADR-005: level/config runtime-configurable).
  if (const char* envPort = std::getenv("AGENTICRPG_PORT"); envPort != nullptr) {
    cfg.port = parsePort(envPort);
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
      cfg.port = parsePort(requireNext(args, i, arg));
    } else if (arg == "--www-root") {
      cfg.wwwRoot = requireNext(args, i, arg);
    } else if (arg == "--log-level") {
      cfg.logLevel = requireNext(args, i, arg);
    } else {
      throw std::runtime_error("unknown argument '" + arg + "' (see --help)");
    }
  }
  return cfg;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const ServerConfig cfg = parseArgs(argc, argv);

    // Logging seam: level is runtime-configurable, never hard-coded
    // (03-wal-process.md §2).
    spdlog::set_level(parseLogLevel(cfg.logLevel));

    spdlog::info("AgenticRPGMaker server (P0 scaffold) starting");
    spdlog::info("config: port={}, www_root={}, log_level={}", cfg.port, cfg.wwwRoot, cfg.logLevel);
    spdlog::info(
        "would listen on 0.0.0.0:{} — HTTP static serving and the WebSocket relay arrive in P3 "
        "(ADR-005)",
        cfg.port);
    spdlog::info("server initialized successfully (P0 scaffold; nothing to serve yet)");
    return 0;
  } catch (const std::exception& e) {
    // Never log secrets; an exception message from argument parsing is safe.
    spdlog::critical("fatal: {}", e.what());
    std::cerr << "error: " << e.what() << "\nrun with --help for usage\n";
    return 1;
  }
}
