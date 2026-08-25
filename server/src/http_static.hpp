// AgenticRPGMaker — custom HTTP static file serving (ADR-005).
//
// Security-relevant code: paths are canonicalized (.. / absolute / percent-
// encoded traversal rejected), MIME types come from an explicit allow-list,
// directory requests serve index.html, and there is no CGI/exec of any kind.
// Serves GET requests from the www root (default) or the editor root (paths
// under /editor). Requests are bounded and only GET is supported.

#ifndef AGENTICRPG_SERVER_HTTP_STATIC_HPP
#define AGENTICRPG_SERVER_HTTP_STATIC_HPP

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace agenticrpg {

// Result of a static file lookup. `path` is the filesystem path to serve and
// `mime` the allow-listed content type; `notFound` marks a clean miss.
struct StaticFileResult {
  bool notFound = false;
  bool forbidden = false;
  bool tooLarge = false;
  std::filesystem::path path;
  std::string mime;
};

// Canonicalizes a raw request path (e.g. "/js/main.js?x=1") against a root.
// Rejects traversal (".."), absolute/backslash paths, percent-encoded
// traversal and NUL bytes. Directory requests resolve to index.html.
// Returns std::nullopt when the path is unsafe/invalid.
std::optional<std::string> canonicalizePath(std::string_view rawPath);

// Maps a file extension to a MIME type from the explicit allow-list.
// Returns an empty string for extensions that are not allowed to be served.
std::string mimeForPath(const std::filesystem::path& path);

// Resolves a canonical (relative) path under `root` and returns the file to
// serve. Handles directory -> index.html resolution and missing files.
StaticFileResult resolveStaticFile(const std::filesystem::path& root,
                                   std::string_view canonicalPath);

// Top-level static handler: picks www vs editor root by path prefix and
// resolves. Returns the resolved file to serve.
StaticFileResult handleStaticRequest(std::string_view rawPath,
                                     const std::filesystem::path& wwwRoot,
                                     const std::filesystem::path& editorRoot);

// Cap on a single served file, to bound memory for a hand-rolled surface.
inline constexpr std::uintmax_t kMaxStaticFileBytes = 64 * 1024 * 1024;

}  // namespace agenticrpg

#endif  // AGENTICRPG_SERVER_HTTP_STATIC_HPP