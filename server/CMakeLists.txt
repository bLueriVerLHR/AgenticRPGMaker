# AgenticRPGMaker — C++ relay/state-sync server (ADR-005 / RQ3).
#
# One C++20 Linux executable that will serve the portable www package, the
# editor build, and host the multiplayer WebSocket relay. P0 provides the
# CMake skeleton + pinned FetchContent dependencies + the spdlog logging seam;
# HTTP static serving and the WebSocket relay arrive in P3.

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

# spdlog as header-only (the P0 logging seam needs only the logger; keeps the
# dependency surface header-only as ADR-005 intends).
set(SPDLOG_HEADER_ONLY ON CACHE BOOL "Build spdlog as header-only" FORCE)

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

# Catch2's own CMakeLists appends its module path in a subdirectory scope,
# which does not propagate up; re-add it here for `include(Catch)`.
list(APPEND CMAKE_MODULE_PATH "${catch2_SOURCE_DIR}/contrib")

find_package(Threads REQUIRED)

# All third-party includes/links behind one INTERFACE target (ADR-005).
add_library(agenticrpg_third_party INTERFACE)
target_include_directories(
  agenticrpg_third_party
  INTERFACE
    ${asio_SOURCE_DIR}/asio/include
    ${websocketpp_SOURCE_DIR}
)
target_link_libraries(agenticrpg_third_party INTERFACE spdlog::spdlog Threads::Threads)

# ---- Executable --------------------------------------------------------------
add_executable(agenticrpg-server src/main.cpp)
target_link_libraries(agenticrpg-server PRIVATE agenticrpg_third_party)
target_compile_options(agenticrpg-server PRIVATE -Wall -Wextra -Wpedantic)

# ---- Tests (Catch2) ----------------------------------------------------------
option(AGENTICRPG_BUILD_TESTS "Build the Catch2 unit tests" ON)
if(AGENTICRPG_BUILD_TESTS)
  enable_testing()
  add_executable(agenticrpg-server-tests tests/main_test.cpp)
  target_link_libraries(agenticrpg-server-tests PRIVATE Catch2::Catch2 agenticrpg_third_party)
  target_compile_options(agenticrpg-server-tests PRIVATE -Wall -Wextra -Wpedantic)
  include(Catch)
  catch_discover_tests(agenticrpg-server-tests)
endif()
