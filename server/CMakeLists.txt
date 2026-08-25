# AgenticRPGMaker — C++ relay/state-sync server (ADR-005 / RQ3).
#
# One C++20 Linux executable that serves the portable www package, the
# editor build, and hosts the multiplayer WebSocket relay on the same port.
# Dependencies are pinned via FetchContent for reproducible builds (asio,
# websocketpp, spdlog, Catch2 + nlohmann/json for the protocol envelope).

cmake_minimum_required(VERSION 3.20)
project(agenticrpg-server LANGUAGES CXX VERSION 0.1.0)

# ---- Global settings ---------------------------------------------------------
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

include(FetchContent)

# spdlog as header-only (ADR-005: header-only dependency surface).
set(SPDLOG_HEADER_ONLY ON CACHE BOOL "Build spdlog as header-only" FORCE)

# nlohmann/json: header-only; never build its test suite.
set(JSON_BuildTests OFF CACHE BOOL "Disable nlohmann/json tests" FORCE)
set(JSON_ImplicitConversions OFF CACHE BOOL "Disable implicit conversions" FORCE)

# ---- Pinned third-party dependencies (ADR-005 / RQ3) -------------------------
# Versions are pinned for reproducible builds. A documented vendoring fallback
# for offline environments is a follow-up (ADR-005, "Negative" section).
FetchContent_Declare(
  asio
  GIT_REPOSITORY https://github.com/chriskohlhoff/asio.git
  GIT_TAG asio-1-30-2
)
FetchContent_Declare(
  websocketpp
  GIT_REPOSITORY https://github.com/zaphoyd/websocketpp.git
  GIT_TAG 0.8.2
)
FetchContent_Declare(
  spdlog
  GIT_REPOSITORY https://github.com/gabime/spdlog.git
  GIT_TAG v1.14.1
)
FetchContent_Declare(
  Catch2
  GIT_REPOSITORY https://github.com/catchorg/Catch2.git
  GIT_TAG v2.13.10
)
# JSON parser for the ADR-004 protocol envelope. Single header, header-only.
# Chosen over writing a hand-rolled parser: it is the de-facto standard,
# dependency-free (header-only), and pinned for reproducibility (ADR-005 §7).
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
)

# Header-only libraries: fetch the sources, expose include dirs (no build).
FetchContent_GetProperties(asio)
if(NOT asio_POPULATED)
  FetchContent_Populate(asio)
endif()
FetchContent_GetProperties(websocketpp)
if(NOT websocketpp_POPULATED)
  FetchContent_Populate(websocketpp)
endif()

# Libraries that define CMake targets.
FetchContent_MakeAvailable(spdlog)
FetchContent_MakeAvailable(Catch2)
FetchContent_MakeAvailable(nlohmann_json)

# Catch2's own CMakeLists appends its module path in a subdirectory scope,
# which does not propagate up; re-add it here for `include(Catch)`.
list(APPEND CMAKE_MODULE_PATH "${catch2_SOURCE_DIR}/contrib")

find_package(Threads REQUIRED)

# All third-party includes/links behind one INTERFACE target (ADR-005).
# Headers are SYSTEM so warnings from vendored/pinned dependencies (e.g.
# websocketpp's C++20 template-id ctor/dtor) do not pollute our build.
add_library(agenticrpg_third_party INTERFACE)
target_include_directories(
  agenticrpg_third_party
  SYSTEM INTERFACE
    ${asio_SOURCE_DIR}/asio/include
    ${websocketpp_SOURCE_DIR}
)
target_link_libraries(
  agenticrpg_third_party
  INTERFACE spdlog::spdlog nlohmann_json::nlohmann_json Threads::Threads
)
# websocketpp needs standalone asio (no boost) and C++11 threading; both are
# selected at compile time via these definitions.
target_compile_definitions(agenticrpg_third_party INTERFACE ASIO_STANDALONE)

# ---- Server core (static lib) -------------------------------------------------
add_library(agenticrpg-server-lib STATIC
  src/rate_limiter.cpp
  src/outbound_queue.cpp
  src/server.cpp
  src/protocol.cpp
  src/room_registry.cpp
  src/config.cpp
  src/http_static.cpp
)
target_include_directories(agenticrpg-server-lib PUBLIC src)
target_link_libraries(agenticrpg-server-lib PUBLIC agenticrpg_third_party)
target_compile_options(agenticrpg-server-lib PRIVATE -Wall -Wextra -Wpedantic)

# ---- Executable --------------------------------------------------------------
add_executable(agenticrpg-server src/main.cpp)
target_link_libraries(agenticrpg-server PRIVATE agenticrpg-server-lib agenticrpg_third_party)
target_compile_options(agenticrpg-server PRIVATE -Wall -Wextra -Wpedantic)

# ---- Tests (Catch2) ----------------------------------------------------------
option(AGENTICRPG_BUILD_TESTS "Build the Catch2 unit tests" ON)
if(AGENTICRPG_BUILD_TESTS)
  enable_testing()
  add_executable(agenticrpg-server-tests
    tests/test_config.cpp
    tests/test_http_static.cpp
    tests/test_outbound_queue.cpp
    tests/test_protocol.cpp
    tests/test_rate_limiter.cpp
    tests/test_room_registry.cpp
    tests/test_loopback.cpp
    tests/main_test.cpp
  )
  target_link_libraries(agenticrpg-server-tests PRIVATE Catch2::Catch2 agenticrpg-server-lib agenticrpg_third_party)
  target_compile_options(agenticrpg-server-tests PRIVATE -Wall -Wextra -Wpedantic)
  include(Catch)
  catch_discover_tests(agenticrpg-server-tests)
endif()
