// AgenticRPGMaker — HTTP static serving unit tests.
//
// Covers ADR-005 static-serving safety: path canonicalization (traversal,
// absolute, encoded traversal), the MIME allow-list, directory -> index.html
// and the www vs /editor root mapping.

#include <catch2/catch.hpp>

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <unistd.h>
#include <vector>

#include "http_static.hpp"

namespace {

// RAII temp directory for fixture files.
class TempDir {
 public:
  TempDir() {
    path_ = std::filesystem::temp_directory_path() /
           ("agenticrpg-test-" + std::to_string(::getpid()) + "-" +
            std::to_string(counter_++));
    std::filesystem::create_directories(path_);
  }
  ~TempDir() { std::error_code ec; std::filesystem::remove_all(path_, ec); }
  const std::filesystem::path& path() const { return path_; }

 private:
  static int counter_;
  std::filesystem::path path_;
};

int TempDir::counter_ = 0;

void writeFile(const std::filesystem::path& p, const std::string& content) {
  std::filesystem::create_directories(p.parent_path());
  std::ofstream out(p, std::ios::binary);
  out << content;
}

}  // namespace

TEST_CASE("http: canonicalizePath accepts normal relative paths", "[unit][http]") {
  REQUIRE(agenticrpg::canonicalizePath("/index.html") == "/index.html");
  REQUIRE(agenticrpg::canonicalizePath("/js/main.js?x=1") == "/js/main.js");
  REQUIRE(agenticrpg::canonicalizePath("/") == "/");
  REQUIRE(agenticrpg::canonicalizePath("/a/b/c.txt") == "/a/b/c.txt");
  REQUIRE(agenticrpg::canonicalizePath("/a/./b") == "/a/./b");  // "." is inert
}

TEST_CASE("http: canonicalizePath rejects traversal and absolute paths", "[unit][http]") {
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/../etc/passwd").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/a/../b").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/a/%2e%2e/b").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/a/%2E%2E/b").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/a/..%2fb").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("..").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("http://evil/x").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/a\\b").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/a%00b").has_value());
  REQUIRE_FALSE(agenticrpg::canonicalizePath("/a/%zz").has_value());
}

TEST_CASE("http: MIME allow-list", "[unit][http]") {
  REQUIRE(agenticrpg::mimeForPath("index.html") == "text/html; charset=utf-8");
  REQUIRE(agenticrpg::mimeForPath("app.js") == "text/javascript; charset=utf-8");
  REQUIRE(agenticrpg::mimeForPath("app.mjs") == "text/javascript; charset=utf-8");
  REQUIRE(agenticrpg::mimeForPath("style.css") == "text/css; charset=utf-8");
  REQUIRE(agenticrpg::mimeForPath("pic.png") == "image/png");
  REQUIRE(agenticrpg::mimeForPath("pic.JPG") == "image/jpeg");  // case-insensitive
  REQUIRE(agenticrpg::mimeForPath("data.json") == "application/json; charset=utf-8");
  REQUIRE(agenticrpg::mimeForPath("font.woff2") == "font/woff2");
  REQUIRE(agenticrpg::mimeForPath("sound.mp3") == "audio/mpeg");
  // Not on the allow-list: unknown extensions are refused.
  REQUIRE(agenticrpg::mimeForPath("secret.sh").empty());
  REQUIRE(agenticrpg::mimeForPath("evil.php").empty());
  REQUIRE(agenticrpg::mimeForPath("file.exe").empty());
  REQUIRE(agenticrpg::mimeForPath("noext").empty());
}

TEST_CASE("http: resolveStaticFile serves files, index.html, 404s", "[unit][http]") {
  TempDir dir;
  writeFile(dir.path() / "index.html", "<html>www</html>");
  writeFile(dir.path() / "js" / "app.js", "console.log(1);");
  writeFile(dir.path() / "sub" / "index.html", "<html>sub</html>");
  writeFile(dir.path() / "data.json", "{\"a\":1}");

  const auto r1 = agenticrpg::resolveStaticFile(dir.path(), "/");
  REQUIRE_FALSE(r1.notFound);
  REQUIRE_FALSE(r1.forbidden);
  REQUIRE(r1.path == dir.path() / "index.html");
  REQUIRE(r1.mime == "text/html; charset=utf-8");

  const auto r2 = agenticrpg::resolveStaticFile(dir.path(), "/js/app.js");
  REQUIRE_FALSE(r2.notFound);
  REQUIRE(r2.path == dir.path() / "js" / "app.js");
  REQUIRE(r2.mime == "text/javascript; charset=utf-8");

  const auto r3 = agenticrpg::resolveStaticFile(dir.path(), "/sub");
  REQUIRE_FALSE(r3.notFound);
  REQUIRE(r3.path == dir.path() / "sub" / "index.html");

  const auto r4 = agenticrpg::resolveStaticFile(dir.path(), "/missing.txt");
  REQUIRE(r4.notFound);

  const auto r5 = agenticrpg::resolveStaticFile(dir.path(), "/data.json");
  REQUIRE_FALSE(r5.notFound);
  REQUIRE(r5.mime == "application/json; charset=utf-8");

  // Unknown extension is not served.
  writeFile(dir.path() / "run.sh", "#!/bin/sh\n");
  const auto r6 = agenticrpg::resolveStaticFile(dir.path(), "/run.sh");
  REQUIRE(r6.notFound);
}

TEST_CASE("http: handleStaticRequest maps /editor to the editor root", "[unit][http]") {
  TempDir www;
  TempDir editor;
  writeFile(www.path() / "index.html", "<html>game</html>");
  writeFile(editor.path() / "index.html", "<html>editor</html>");
  writeFile(editor.path() / "bundle.js", "editor bundle");

  const auto game = agenticrpg::handleStaticRequest("/", www.path(), editor.path());
  REQUIRE_FALSE(game.notFound);
  REQUIRE(game.path == www.path() / "index.html");

  const auto ed = agenticrpg::handleStaticRequest("/editor", www.path(), editor.path());
  REQUIRE_FALSE(ed.notFound);
  REQUIRE(ed.path == editor.path() / "index.html");

  const auto ed2 = agenticrpg::handleStaticRequest("/editor/bundle.js", www.path(), editor.path());
  REQUIRE_FALSE(ed2.notFound);
  REQUIRE(ed2.path == editor.path() / "bundle.js");

  const auto forbidden = agenticrpg::handleStaticRequest("/../etc/passwd", www.path(), editor.path());
  REQUIRE(forbidden.forbidden);
}
