// AgenticRPGMaker — C++ server entry point (P3).
//
// ADR-005 / RQ3: one C++20 Linux executable that serves the portable www
// package and the editor build over custom HTTP and hosts the multiplayer
// WebSocket relay on the same port. Single io_context, one thread for MVP.
//
// Logging policy (03-wal-process.md §2): lifecycle/config at info, protocol
// errors at warn/error, per-message timing at debug; level is
// runtime-configurable via --log-level or AGENTICRPG_LOG_LEVEL and never
// hard-coded. Secrets and chat text are never logged.

#include <spdlog/spdlog.h>

#include <exception>
#include <iostream>

#include "config.hpp"
#include "server.hpp"

int main(int argc, char** argv) {
  try {
    const agenticrpg::ServerConfig cfg = agenticrpg::parseArgs(argc, argv);

    // Logging seam: level is runtime-configurable, never hard-coded.
    spdlog::set_level(agenticrpg::parseLogLevel(cfg.logLevel));
    spdlog::set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] %v");

    spdlog::info("AgenticRPGMaker server starting");
    spdlog::info("config: port={}, www_root={}, editor_root={}, log_level={}, max_players_per_room={}",
                 cfg.port, cfg.wwwRoot, cfg.editorRoot, cfg.logLevel, cfg.maxPlayersPerRoom);

    agenticrpg::Server server(cfg);
    server.start();
    server.run();

    spdlog::info("server shutdown complete");
    return 0;
  } catch (const std::exception& e) {
    // Never log secrets; an exception message from argument parsing or startup
    // is configuration detail, not secret material.
    spdlog::critical("fatal: {}", e.what());
    std::cerr << "error: " << e.what() << "\nrun with --help for usage\n";
    return 1;
  }
}