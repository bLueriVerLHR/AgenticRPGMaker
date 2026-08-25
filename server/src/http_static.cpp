// AgenticRPGMaker — custom HTTP static file serving implementation.

#include "http_static.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace agenticrpg {
namespace {

// Percent-decodes a path segment. Returns std::nullopt on invalid encodings
// (truncated %XX) or if decoding would produce a NUL byte.
std::optional<std::string> percentDecode(std::string_view input) {
  std::string out;
  out.reserve(input.size());
  for (std::size_t i = 0; i < input.size(); ++i) {
    const char c = input[i];
    if (c != '%') {
      out.push_back(c);
      continue;
    }
    // Need two hex digits after '%'.
    if (i + 2 >= input.size()) {
      return std::nullopt;
    }
    const auto hexVal = [](char h) -> int {
      if (h >= '0' && h <= '9') return h - '0';
      if (h >= 'a' && h <= 'f') return h - 'a' + 10;
      if (h >= 'A' && h <= 'F') return h - 'A' + 10;
      return -1;
    };
    const int hi = hexVal(input[i + 1]);
    const int lo = hexVal(input[i + 2]);
    if (hi < 0 || lo < 0) {
      return std::nullopt;
    }
    const char decoded = static_cast<char>((hi << 4) | lo);
    if (decoded == '\0') {
      return std::nullopt;
    }
    out.push_back(decoded);
    i += 2;
  }
  return out;
}

// Splits a path on '/' into non-empty segments.
std::vector<std::string_view> splitSegments(std::string_view path) {
  std::vector<std::string_view> segments;
  std::size_t start = 0;
  while (start <= path.size()) {
    const std::size_t slash = path.find('/', start);
    const std::string_view seg =
        slash == std::string_view::npos ? path.substr(start) : path.substr(start, slash - start);
    if (!seg.empty()) {
      segments.push_back(seg);
    }
    if (slash == std::string_view::npos) {
      break;
    }
    start = slash + 1;
  }
  return segments;
}

}  // namespace

std::optional<std::string> canonicalizePath(std::string_view rawPath) {
  // Strip any query string ("?...").
  std::string_view path = rawPath;
  if (const std::size_t q = path.find('?'); q != std::string_view::npos) {
    path = path.substr(0, q);
  }

  // Must be a path, not an absolute/opaque URI. Reject backslash and NUL in
  // the raw form as well (defense in depth against Windows-style traversal).
  if (path.empty() || path.front() != '/') {
    return std::nullopt;
  }
  if (path.find('\\') != std::string_view::npos) {
    return std::nullopt;
  }
  if (path.find('\0') != std::string_view::npos) {
    return std::nullopt;
  }

  const std::optional<std::string> decoded = percentDecode(path);
  if (!decoded) {
    return std::nullopt;
  }
  // Re-check decoded form for backslash/NUL.
  if (decoded->find('\\') != std::string::npos ||
      decoded->find('\0') != std::string::npos) {
    return std::nullopt;
  }

  // Reject any ".." segment (traversal). "." segments collapse away.
  for (const std::string_view seg : splitSegments(*decoded)) {
    if (seg == "..") {
      return std::nullopt;
    }
  }

  return *decoded;
}

std::string mimeForPath(const std::filesystem::path& path) {
  static const std::unordered_map<std::string, std::string> kMimeMap = {
      {".html", "text/html; charset=utf-8"},
      {".js", "text/javascript; charset=utf-8"},
      {".mjs", "text/javascript; charset=utf-8"},
      {".css", "text/css; charset=utf-8"},
      {".png", "image/png"},
      {".jpg", "image/jpeg"},
      {".jpeg", "image/jpeg"},
      {".gif", "image/gif"},
      {".webp", "image/webp"},
      {".json", "application/json; charset=utf-8"},
      {".ogg", "audio/ogg"},
      {".mp3", "audio/mpeg"},
      {".woff2", "font/woff2"},
      {".svg", "image/svg+xml"},
      {".ico", "image/x-icon"},
      {".txt", "text/plain; charset=utf-8"},
  };
  std::string ext = path.extension().string();
  std::transform(ext.begin(), ext.end(), ext.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  const auto it = kMimeMap.find(ext);
  return it == kMimeMap.end() ? std::string() : it->second;
}

StaticFileResult resolveStaticFile(const std::filesystem::path& root,
                                   std::string_view canonicalPath) {
  StaticFileResult result;

  // Build the filesystem path from the canonical (relative-to-root) path.
  // relative_path() strips the leading "/" so "/" maps to the root itself and
  // "/a/b" maps to a/b under the root (canonicalizePath guarantees no "..").
  const std::filesystem::path rel =
      std::filesystem::path(std::string(canonicalPath)).relative_path();
  if (rel.is_absolute()) {
    result.forbidden = true;
    return result;
  }

  std::filesystem::path candidate = root / rel;
  std::error_code ec;
  const std::filesystem::file_status st = std::filesystem::status(candidate, ec);
  if (ec) {
    result.notFound = true;
    return result;
  }

  if (std::filesystem::is_directory(st)) {
    candidate /= "index.html";
    const std::filesystem::file_status idx = std::filesystem::status(candidate, ec);
    if (ec || !std::filesystem::is_regular_file(idx)) {
      result.notFound = true;
      return result;
    }
  } else if (!std::filesystem::is_regular_file(st)) {
    result.notFound = true;
    return result;
  }

  const std::uintmax_t size = std::filesystem::file_size(candidate, ec);
  if (ec) {
    result.notFound = true;
    return result;
  }
  if (size > kMaxStaticFileBytes) {
    result.tooLarge = true;
    return result;
  }

  const std::string mime = mimeForPath(candidate);
  if (mime.empty()) {
    result.notFound = true;
    return result;
  }

  result.path = candidate;
  result.mime = mime;
  return result;
}

StaticFileResult handleStaticRequest(std::string_view rawPath,
                                     const std::filesystem::path& wwwRoot,
                                     const std::filesystem::path& editorRoot) {
  const std::optional<std::string> canonical = canonicalizePath(rawPath);
  if (!canonical) {
    StaticFileResult result;
    result.forbidden = true;
    return result;
  }

  // The editor build is served under the /editor prefix; everything else comes
  // from the www root (ADR-005: one binary serves both www and editor).
  constexpr std::string_view kEditorPrefix = "/editor";
  if (canonical->rfind(kEditorPrefix, 0) == 0) {
    const std::string_view rest = std::string_view(*canonical).substr(kEditorPrefix.size());
    const std::string inner = rest.empty() ? "/" : std::string(rest);
    return resolveStaticFile(editorRoot, inner);
  }
  return resolveStaticFile(wwwRoot, *canonical);
}

}  // namespace agenticrpg