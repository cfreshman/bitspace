#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <queue>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define BS_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define BS_EXPORT extern "C"
#endif

namespace {

constexpr int kMaxCandidates = 32;
constexpr int kMaxBeam = 32;
constexpr int kMaxSteps = 24;
constexpr int kMaxStoredStates = kMaxBeam * kMaxCandidates * kMaxSteps + kMaxBeam;
constexpr double kEpsilon = 0.000001;
constexpr int kPathDirectionCount = 5;
constexpr int kPathStartDirection = 4;

struct Blocker {
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  double radius = 0;
  int cornerMask = 0;
};

struct Control {
  double x = 0;
  double y = 0;
  int thrust = 0;
};

struct State {
  double x = 0;
  double y = 0;
  double vx = 0;
  double vy = 0;
  double firstMoveX = 0;
  double firstMoveY = 0;
  double moveX = 0;
  double moveY = 0;
  double score = 0;
  double clearance = 0;
  double minClearance = 0;
  int safe = 1;
  int recovering = 0;
  int hitStep = 0;
  int previous = -1;
  int hasMove = 0;
};

struct Primitive {
  int type = 0; // 0 rect, 1 circle
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  double radius = 0;
};

struct PathOptions {
  int width = 0;
  int height = 0;
  double tileSize = 16;
  int allowMining = 0;
  int allowUnsafeStorm = 0;
  int allowUnsafeStart = 0;
  int pathLimitToView = 0;
  double viewOriginX = 0;
  double viewOriginY = 0;
  double viewRadius = 0;
  double pathAirSpeed = 56;
  double pathMiningPower = 1;
  double pathMiningCostMultiplier = 1;
  double pathMiningExtraSeconds = 0;
  double rockSeconds = 0.5;
  double oreSeconds = 0.5;
  double diamondSeconds = 5;
  double stormTileSeconds = 2;
  int stormClearanceTiles = 4;
  double stormEdgeSeconds = 2.4;
  int hasEnemyDanger = 0;
  double enemyDangerX = 0;
  double enemyDangerY = 0;
  double enemyDangerRadius = 0;
  double enemyDangerScale = 1;
  double enemyDangerMaxSeconds = 8.5;
};

struct PathOpenEntry {
  int state = 0;
  double cost = 0;
};

struct PathOpenCompare {
  bool operator()(const PathOpenEntry& a, const PathOpenEntry& b) const {
    return a.cost > b.cost;
  }
};

struct PathScratch {
  std::vector<int> previous;
  std::vector<float> costs;
  std::vector<uint8_t> closed;
  std::vector<float> tileCosts;
};

struct VisibilitySegment {
  double x0 = 0;
  double y0 = 0;
  double x1 = 0;
  double y1 = 0;
  double startAngle = 0;
  double endAngle = 0;
  int wraps = 0;
};

struct VisibilityEvent {
  double angle = 0;
  int segmentIndex = 0;
  int entering = 0;
};

struct VisibilityPoint {
  double x = 0;
  double y = 0;
};

PathScratch& pathScratch() {
  static PathScratch scratch;
  return scratch;
}

double hypot2(double x, double y);

double clampDouble(double value, double minValue, double maxValue) {
  return std::max(minValue, std::min(maxValue, value));
}

bool isFiniteDouble(double value) {
  return std::isfinite(value);
}

bool isMineableTile(uint8_t tile) {
  return tile == 1 || tile == 2 || tile == 3 || tile == 4;
}

int pathStateId(int index, int direction) {
  return index * kPathDirectionCount + direction;
}

int pathStateTile(int stateId) {
  return stateId / kPathDirectionCount;
}

int pathStateDirection(int stateId) {
  return stateId % kPathDirectionCount;
}

int pathDirectionBetween(int width, int fromIndex, int toIndex) {
  if (fromIndex < 0 || toIndex < 0) {
    return kPathStartDirection;
  }
  const int dx = (toIndex % width) - (fromIndex % width);
  const int dy = (toIndex / width) - (fromIndex / width);
  if (dx < 0) {
    return 0;
  }
  if (dx > 0) {
    return 1;
  }
  if (dy < 0) {
    return 2;
  }
  if (dy > 0) {
    return 3;
  }
  return kPathStartDirection;
}

double tileDistanceScore(int width, int a, int b) {
  const double ax = static_cast<double>(a % width);
  const double ay = static_cast<double>(a / width);
  const double bx = static_cast<double>(b % width);
  const double by = static_cast<double>(b / width);
  const double dx = ax - bx;
  const double dy = ay - by;
  return dx * dx + dy * dy;
}

bool pathSafeStormTile(const uint8_t* storm, int tileCount, int index) {
  return !storm || (index >= 0 && index < tileCount && storm[index] == 0);
}

bool pathTileWithinView(int index, const PathOptions& options) {
  if (!options.pathLimitToView) {
    return true;
  }
  if (!isFiniteDouble(options.viewOriginX) || !isFiniteDouble(options.viewOriginY) || !isFiniteDouble(options.viewRadius)) {
    return true;
  }
  const int x = index % options.width;
  const int y = index / options.width;
  const double centerX = (static_cast<double>(x) + 0.5) * options.tileSize;
  const double centerY = (static_cast<double>(y) + 0.5) * options.tileSize;
  return hypot2(centerX - options.viewOriginX, centerY - options.viewOriginY) <= options.viewRadius;
}

bool pathTileAllowed(
  const uint8_t* tiles,
  const uint8_t* playable,
  const uint8_t* storm,
  int tileCount,
  int index,
  int startIndex,
  const PathOptions& options
) {
  if (index < 0 || index >= tileCount) {
    return false;
  }
  const uint8_t tile = tiles[index];
  const bool empty = tile == 0;
  const bool mineable = isMineableTile(tile);
  if (options.allowUnsafeStart && index == startIndex) {
    return empty || (options.allowMining && mineable);
  }
  if (!pathTileWithinView(index, options)) {
    return false;
  }
  const bool safe = pathSafeStormTile(storm, tileCount, index);
  if (options.allowMining && mineable) {
    return safe || options.allowUnsafeStorm;
  }
  if (!playable[index]) {
    return false;
  }
  if (!empty) {
    return false;
  }
  if (safe) {
    return true;
  }
  return options.allowUnsafeStorm ||
    (options.allowUnsafeStart && index == startIndex);
}

int stormClearanceTiles(
  const uint8_t* storm,
  int tileCount,
  int index,
  const PathOptions& options
) {
  if (!storm) {
    return options.stormClearanceTiles;
  }
  if (!pathSafeStormTile(storm, tileCount, index)) {
    return 0;
  }
  const int originX = index % options.width;
  const int originY = index / options.width;
  for (int radius = 1; radius <= options.stormClearanceTiles; ++radius) {
    for (int y = originY - radius; y <= originY + radius; ++y) {
      for (int x = originX - radius; x <= originX + radius; ++x) {
        if (std::max(std::abs(x - originX), std::abs(y - originY)) != radius) {
          continue;
        }
        if (x < 0 || y < 0 || x >= options.width || y >= options.height) {
          return radius - 1;
        }
        const int neighbor = y * options.width + x;
        if (!pathSafeStormTile(storm, tileCount, neighbor)) {
          return radius - 1;
        }
      }
    }
  }
  return options.stormClearanceTiles;
}

double pathMiningSecondsForTile(uint8_t tile, uint8_t amount, float progress, const PathOptions& options) {
  double seconds = 0;
  if (tile == 2) {
    seconds = std::max(1, static_cast<int>(amount)) * options.oreSeconds + options.rockSeconds;
  } else if (tile == 3) {
    seconds = options.diamondSeconds + options.rockSeconds;
  } else if (tile == 1 || tile == 4) {
    seconds = options.rockSeconds;
  }
  if (seconds <= 0) {
    return 0;
  }
  seconds = std::max(0.0, seconds - std::max(0.0f, progress));
  const double miningPower = std::max(0.1, options.pathMiningPower);
  const double multiplier = std::max(0.1, options.pathMiningCostMultiplier);
  return seconds > 0
    ? seconds / miningPower * multiplier + std::max(0.0, options.pathMiningExtraSeconds)
    : 0;
}

double pathTileCostSeconds(
  const uint8_t* tiles,
  const uint8_t* amounts,
  const uint8_t* storm,
  const float* miningProgress,
  int tileCount,
  int index,
  const PathOptions& options
) {
  double cost = options.tileSize / std::max(1.0, options.pathAirSpeed);
  const uint8_t tile = tiles[index];
  if (isMineableTile(tile)) {
    cost += pathMiningSecondsForTile(
      tile,
      amounts ? amounts[index] : 0,
      miningProgress ? miningProgress[index] : 0,
      options
    );
  }
  if (!pathSafeStormTile(storm, tileCount, index) && options.allowUnsafeStorm) {
    cost += options.stormTileSeconds;
  }
  if (storm && pathSafeStormTile(storm, tileCount, index)) {
    const int clearance = stormClearanceTiles(storm, tileCount, index, options);
    const int deficit = std::max(0, options.stormClearanceTiles - clearance);
    cost += deficit * deficit * options.stormEdgeSeconds;
  }
  if (options.hasEnemyDanger) {
    const int x = index % options.width;
    const int y = index / options.width;
    const double centerX = (static_cast<double>(x) + 0.5) * options.tileSize;
    const double centerY = (static_cast<double>(y) + 0.5) * options.tileSize;
    const double radius = std::max(options.tileSize, options.enemyDangerRadius);
    const double distance = hypot2(centerX - options.enemyDangerX, centerY - options.enemyDangerY);
    if (radius > 0 && distance < radius) {
      const double falloff = 1 - distance / radius;
      cost += options.enemyDangerMaxSeconds * clampDouble(options.enemyDangerScale, 0, 1) * falloff * falloff;
    }
  }
  return cost;
}

double pathHeuristicSeconds(int index, int goalIndex, const PathOptions& options) {
  return std::sqrt(tileDistanceScore(options.width, index, goalIndex)) *
    options.tileSize /
    std::max(1.0, options.pathAirSpeed);
}

double normalizeAngle(double angle) {
  const double fullCircle = std::acos(-1) * 2;
  double normalized = std::fmod(angle, fullCircle);
  if (normalized < 0) {
    normalized += fullCircle;
  }
  return normalized;
}

double rayVisibilitySegmentDistance(
  double originX,
  double originY,
  double dirX,
  double dirY,
  const VisibilitySegment& segment
) {
  const double segX = segment.x1 - segment.x0;
  const double segY = segment.y1 - segment.y0;
  const double denom = dirX * segY - dirY * segX;
  if (std::abs(denom) < 0.000001) {
    return -1;
  }

  const double dx = segment.x0 - originX;
  const double dy = segment.y0 - originY;
  const double t = (dx * segY - dy * segX) / denom;
  const double u = (dx * dirY - dy * dirX) / denom;
  if (t < 0 || u < -0.000001 || u > 1.000001) {
    return -1;
  }

  return t;
}

void addVisibilitySample(std::vector<double>& samples, double angle) {
  samples.push_back(normalizeAngle(angle));
}

void applyVisibilityEvents(
  const std::vector<VisibilityEvent>& events,
  int& eventIndex,
  double angle,
  std::vector<uint8_t>& active
) {
  while (eventIndex < static_cast<int>(events.size())) {
    const double groupAngle = events[static_cast<size_t>(eventIndex)].angle;
    if (groupAngle >= angle - 0.000001) {
      break;
    }
    while (
      eventIndex < static_cast<int>(events.size()) &&
      std::abs(events[static_cast<size_t>(eventIndex)].angle - groupAngle) <= 0.000001
    ) {
      const VisibilityEvent& event = events[static_cast<size_t>(eventIndex)];
      active[static_cast<size_t>(event.segmentIndex)] = event.entering ? 1 : 0;
      eventIndex += 1;
    }
  }
}

void visibilityEventGroupRange(
  const std::vector<VisibilityEvent>& events,
  int eventIndex,
  double angle,
  int& start,
  int& end
) {
  start = -1;
  end = -1;
  if (eventIndex >= static_cast<int>(events.size()) ||
      std::abs(events[static_cast<size_t>(eventIndex)].angle - angle) > 0.000001) {
    return;
  }
  start = eventIndex;
  end = eventIndex;
  while (
    end < static_cast<int>(events.size()) &&
    std::abs(events[static_cast<size_t>(end)].angle - angle) <= 0.000001
  ) {
    end += 1;
  }
}

void mergeSpanPairs(std::vector<std::pair<int, int>>& pairs) {
  if (pairs.size() <= 1) {
    return;
  }
  std::sort(pairs.begin(), pairs.end(), [](const auto& a, const auto& b) {
    return a.first < b.first;
  });
  int write = 0;
  for (int read = 1; read < static_cast<int>(pairs.size()); ++read) {
    if (pairs[static_cast<size_t>(read)].first > pairs[static_cast<size_t>(write)].second) {
      write += 1;
      pairs[static_cast<size_t>(write)] = pairs[static_cast<size_t>(read)];
    } else {
      pairs[static_cast<size_t>(write)].second = std::max(
        pairs[static_cast<size_t>(write)].second,
        pairs[static_cast<size_t>(read)].second
      );
    }
  }
  pairs.resize(static_cast<size_t>(write + 1));
}

uint32_t mixBits(uint32_t value) {
  value ^= value >> 16;
  value *= 0x7feb352dU;
  value ^= value >> 15;
  value *= 0x846ca68bU;
  value ^= value >> 16;
  return value;
}

double hashUnit3(int x, int y, int z, uint32_t seed) {
  uint32_t value = seed;
  value ^= static_cast<uint32_t>(x) * 0x9e3779b1U;
  value ^= static_cast<uint32_t>(y) * 0x85ebca6bU;
  value ^= static_cast<uint32_t>(z) * 0xc2b2ae35U;
  return static_cast<double>(mixBits(value)) / 4294967295.0;
}

double smoothStep(double value) {
  return value * value * (3 - 2 * value);
}

double lerpDouble(double a, double b, double t) {
  return a + (b - a) * t;
}

double valueNoise3(double x, double y, double z, uint32_t seed) {
  const int x0 = static_cast<int>(std::floor(x));
  const int y0 = static_cast<int>(std::floor(y));
  const int z0 = static_cast<int>(std::floor(z));
  const double fx = smoothStep(x - x0);
  const double fy = smoothStep(y - y0);
  const double fz = smoothStep(z - z0);

  const double c000 = hashUnit3(x0, y0, z0, seed);
  const double c100 = hashUnit3(x0 + 1, y0, z0, seed);
  const double c010 = hashUnit3(x0, y0 + 1, z0, seed);
  const double c110 = hashUnit3(x0 + 1, y0 + 1, z0, seed);
  const double c001 = hashUnit3(x0, y0, z0 + 1, seed);
  const double c101 = hashUnit3(x0 + 1, y0, z0 + 1, seed);
  const double c011 = hashUnit3(x0, y0 + 1, z0 + 1, seed);
  const double c111 = hashUnit3(x0 + 1, y0 + 1, z0 + 1, seed);

  const double x00 = lerpDouble(c000, c100, fx);
  const double x10 = lerpDouble(c010, c110, fx);
  const double x01 = lerpDouble(c001, c101, fx);
  const double x11 = lerpDouble(c011, c111, fx);
  const double y0v = lerpDouble(x00, x10, fy);
  const double y1v = lerpDouble(x01, x11, fy);
  return lerpDouble(y0v, y1v, fz);
}

double stormVisualNoise(double x, double y, double z, uint32_t seed) {
  double value = 0;
  double amplitude = 1;
  double weight = 0;
  double frequency = 1;
  for (int octave = 0; octave < 4; ++octave) {
    value += (valueNoise3(x * frequency, y * frequency, z * frequency, seed + static_cast<uint32_t>(octave) * 1013U) * 2 - 1) * amplitude;
    weight += amplitude;
    amplitude *= 0.52;
    frequency *= 2.07;
  }
  return weight > 0 ? clampDouble((value / weight) * 2.35, -1.0, 1.0) : 0;
}

bool visibilityInBounds(int width, int height, int tileX, int tileY) {
  return tileX >= 0 && tileY >= 0 && tileX < width && tileY < height;
}

bool visibilityPlayable(const uint8_t* playable, int width, int height, int tileX, int tileY) {
  if (!visibilityInBounds(width, height, tileX, tileY)) {
    return false;
  }
  return playable[tileY * width + tileX] != 0;
}

bool visibilityRockTile(uint8_t tile) {
  return tile == 1 || tile == 2 || tile == 3;
}

bool visibilitySolidTile(uint8_t tile) {
  return visibilityRockTile(tile) || tile == 4;
}

int visibilityBlockerKind(
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  int tileX,
  int tileY
) {
  if (!visibilityPlayable(playable, width, height, tileX, tileY)) {
    return 0;
  }
  const uint8_t tile = tiles[tileY * width + tileX];
  if (visibilityRockTile(tile)) {
    return 1;
  }
  return tile == 4 ? 2 : 0;
}

bool visibilityBlocksSightTile(
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  int tileX,
  int tileY
) {
  if (!visibilityPlayable(playable, width, height, tileX, tileY)) {
    return false;
  }
  return visibilitySolidTile(tiles[tileY * width + tileX]);
}

bool visibilityRockTileAt(
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  int tileX,
  int tileY
) {
  if (!visibilityPlayable(playable, width, height, tileX, tileY)) {
    return false;
  }
  return visibilityRockTile(tiles[tileY * width + tileX]);
}

bool visibilityTileRectTouchesCircleWorld(
  double left,
  double top,
  double size,
  double centerX,
  double centerY,
  double radiusSq
) {
  const double closestX = clampDouble(centerX, left, left + size);
  const double closestY = clampDouble(centerY, top, top + size);
  const double dx = centerX - closestX;
  const double dy = centerY - closestY;
  return dx * dx + dy * dy <= radiusSq;
}

void pushVisibilitySegmentData(
  std::vector<double>& segmentData,
  double x0,
  double y0,
  double x1,
  double y1,
  double cameraX,
  double cameraY
) {
  if (x0 == x1 && y0 == y1) {
    return;
  }
  segmentData.push_back(x0 - cameraX);
  segmentData.push_back(y0 - cameraY);
  segmentData.push_back(x1 - cameraX);
  segmentData.push_back(y1 - cameraY);
}

void addGridVisibilitySquareSegments(
  std::vector<double>& segmentData,
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  int tileX,
  int tileY,
  double left,
  double top,
  double size,
  double cameraX,
  double cameraY
) {
  const double right = left + size;
  const double bottom = top + size;
  if (!visibilityBlocksSightTile(tiles, playable, width, height, tileX, tileY - 1)) {
    pushVisibilitySegmentData(segmentData, left, top, right, top, cameraX, cameraY);
  }
  if (!visibilityBlocksSightTile(tiles, playable, width, height, tileX + 1, tileY)) {
    pushVisibilitySegmentData(segmentData, right, top, right, bottom, cameraX, cameraY);
  }
  if (!visibilityBlocksSightTile(tiles, playable, width, height, tileX, tileY + 1)) {
    pushVisibilitySegmentData(segmentData, right, bottom, left, bottom, cameraX, cameraY);
  }
  if (!visibilityBlocksSightTile(tiles, playable, width, height, tileX - 1, tileY)) {
    pushVisibilitySegmentData(segmentData, left, bottom, left, top, cameraX, cameraY);
  }
}

void addGridVisibilityRockEdgeSegment(
  std::vector<double>& segmentData,
  double x0,
  double y0,
  double x1,
  double y1,
  double cameraX,
  double cameraY,
  int overlap
) {
  if (y0 == y1) {
    const int direction = x1 >= x0 ? 1 : -1;
    pushVisibilitySegmentData(segmentData, x0 - direction * overlap, y0, x1 + direction * overlap, y1, cameraX, cameraY);
    return;
  }
  if (x0 == x1) {
    const int direction = y1 >= y0 ? 1 : -1;
    pushVisibilitySegmentData(segmentData, x0, y0 - direction * overlap, x1, y1 + direction * overlap, cameraX, cameraY);
    return;
  }
  pushVisibilitySegmentData(segmentData, x0, y0, x1, y1, cameraX, cameraY);
}

void addGridVisibilityRockSegments(
  std::vector<double>& segmentData,
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  int tileX,
  int tileY,
  double left,
  double top,
  double size,
  double cameraX,
  double cameraY,
  int outerBevel,
  int innerCorner,
  int overlap
) {
  const bool north = visibilityBlocksSightTile(tiles, playable, width, height, tileX, tileY - 1);
  const bool east = visibilityBlocksSightTile(tiles, playable, width, height, tileX + 1, tileY);
  const bool south = visibilityBlocksSightTile(tiles, playable, width, height, tileX, tileY + 1);
  const bool west = visibilityBlocksSightTile(tiles, playable, width, height, tileX - 1, tileY);
  const bool northWest = visibilityBlocksSightTile(tiles, playable, width, height, tileX - 1, tileY - 1);
  const bool northEast = visibilityBlocksSightTile(tiles, playable, width, height, tileX + 1, tileY - 1);
  const bool southEast = visibilityBlocksSightTile(tiles, playable, width, height, tileX + 1, tileY + 1);
  const bool southWest = visibilityBlocksSightTile(tiles, playable, width, height, tileX - 1, tileY + 1);
  const double right = left + size - 1;
  const double bottom = top + size - 1;
  const bool topOpen = !north;
  const bool rightOpen = !east;
  const bool bottomOpen = !south;
  const bool leftOpen = !west;
  const bool outerTopLeft = topOpen && leftOpen;
  const bool outerTopRight = topOpen && rightOpen;
  const bool outerBottomRight = bottomOpen && rightOpen;
  const bool outerBottomLeft = bottomOpen && leftOpen;
  const int topTrimLeft = outerTopLeft ? outerBevel : (topOpen && west && northWest ? innerCorner : 0);
  const int topTrimRight = outerTopRight ? outerBevel : (topOpen && east && northEast ? innerCorner : 0);
  const int rightTrimTop = outerTopRight ? outerBevel : (rightOpen && north && northEast ? innerCorner : 0);
  const int rightTrimBottom = outerBottomRight ? outerBevel : (rightOpen && south && southEast ? innerCorner : 0);
  const int bottomTrimRight = outerBottomRight ? outerBevel : (bottomOpen && east && southEast ? innerCorner : 0);
  const int bottomTrimLeft = outerBottomLeft ? outerBevel : (bottomOpen && west && southWest ? innerCorner : 0);
  const int leftTrimBottom = outerBottomLeft ? outerBevel : (leftOpen && south && southWest ? innerCorner : 0);
  const int leftTrimTop = outerTopLeft ? outerBevel : (leftOpen && north && northWest ? innerCorner : 0);

  if (topOpen && left + topTrimLeft <= right - topTrimRight) {
    addGridVisibilityRockEdgeSegment(segmentData, left + topTrimLeft, top, right - topTrimRight, top, cameraX, cameraY, overlap);
  }
  if (rightOpen && top + rightTrimTop <= bottom - rightTrimBottom) {
    addGridVisibilityRockEdgeSegment(segmentData, right, top + rightTrimTop, right, bottom - rightTrimBottom, cameraX, cameraY, overlap);
  }
  if (bottomOpen && left + bottomTrimLeft <= right - bottomTrimRight) {
    addGridVisibilityRockEdgeSegment(segmentData, right - bottomTrimRight, bottom, left + bottomTrimLeft, bottom, cameraX, cameraY, overlap);
  }
  if (leftOpen && top + leftTrimTop <= bottom - leftTrimBottom) {
    addGridVisibilityRockEdgeSegment(segmentData, left, bottom - leftTrimBottom, left, top + leftTrimTop, cameraX, cameraY, overlap);
  }

  if (outerTopLeft) {
    pushVisibilitySegmentData(segmentData, left + outerBevel, top, left, top + outerBevel, cameraX, cameraY);
  }
  if (outerTopRight) {
    pushVisibilitySegmentData(segmentData, right, top + outerBevel, right - outerBevel, top, cameraX, cameraY);
  }
  if (outerBottomRight) {
    pushVisibilitySegmentData(segmentData, right - outerBevel, bottom, right, bottom - outerBevel, cameraX, cameraY);
  }
  if (outerBottomLeft) {
    pushVisibilitySegmentData(segmentData, left + outerBevel, bottom, left, bottom - outerBevel, cameraX, cameraY);
  }
}

void addGridVisibilityInnerCornerSegments(
  std::vector<double>& segmentData,
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  int minTileX,
  int maxTileX,
  int minTileY,
  int maxTileY,
  double playerX,
  double playerY,
  double radiusSq,
  double tileSize,
  double cameraX,
  double cameraY,
  int innerCorner
) {
  for (int tileY = minTileY - 1; tileY <= maxTileY + 1; ++tileY) {
    for (int tileX = minTileX - 1; tileX <= maxTileX + 1; ++tileX) {
      if (visibilityBlockerKind(tiles, playable, width, height, tileX, tileY)) {
        continue;
      }
      const double left = static_cast<double>(tileX) * tileSize;
      const double top = static_cast<double>(tileY) * tileSize;
      if (!visibilityTileRectTouchesCircleWorld(left, top, tileSize, playerX, playerY, radiusSq)) {
        continue;
      }

      const double rightEdge = left + tileSize;
      const double bottomEdge = top + tileSize;
      const double topEdge = top - 1;
      const double leftEdge = left - 1;
      const double rightInside = rightEdge - 1;
      const double bottomInside = bottomEdge - 1;
      const bool north = visibilityRockTileAt(tiles, playable, width, height, tileX, tileY - 1);
      const bool east = visibilityRockTileAt(tiles, playable, width, height, tileX + 1, tileY);
      const bool south = visibilityRockTileAt(tiles, playable, width, height, tileX, tileY + 1);
      const bool west = visibilityRockTileAt(tiles, playable, width, height, tileX - 1, tileY);
      const bool northWest = visibilityRockTileAt(tiles, playable, width, height, tileX - 1, tileY - 1);
      const bool northEast = visibilityRockTileAt(tiles, playable, width, height, tileX + 1, tileY - 1);
      const bool southEast = visibilityRockTileAt(tiles, playable, width, height, tileX + 1, tileY + 1);
      const bool southWest = visibilityRockTileAt(tiles, playable, width, height, tileX - 1, tileY + 1);

      if (north && west && northWest) {
        pushVisibilitySegmentData(segmentData, left + innerCorner, topEdge, leftEdge, top + innerCorner, cameraX, cameraY);
      }
      if (north && east && northEast) {
        pushVisibilitySegmentData(segmentData, rightInside - innerCorner, topEdge, rightEdge, top + innerCorner, cameraX, cameraY);
      }
      if (south && east && southEast) {
        pushVisibilitySegmentData(segmentData, rightEdge, bottomInside - innerCorner, rightInside - innerCorner, bottomEdge, cameraX, cameraY);
      }
      if (south && west && southWest) {
        pushVisibilitySegmentData(segmentData, left + innerCorner, bottomEdge, leftEdge, bottomInside - innerCorner, cameraX, cameraY);
      }
    }
  }
}

double hypot2(double x, double y) {
  return std::sqrt(x * x + y * y);
}

double pointDistanceToBounds(double x, double y, const Blocker& blocker) {
  const double right = blocker.x + blocker.width;
  const double bottom = blocker.y + blocker.height;
  const double dx = x < blocker.x ? blocker.x - x : (x > right ? x - right : 0);
  const double dy = y < blocker.y ? blocker.y - y : (y > bottom ? y - bottom : 0);
  return hypot2(dx, dy);
}

double pointInsideBoundsDepth(double x, double y, const Blocker& blocker) {
  const double right = blocker.x + blocker.width;
  const double bottom = blocker.y + blocker.height;
  if (x < blocker.x || x > right || y < blocker.y || y > bottom) {
    return 0;
  }
  return std::min(std::min(x - blocker.x, right - x), std::min(y - blocker.y, bottom - y));
}

bool pointInRoundedCutout(double x, double y, const Blocker& blocker) {
  const double radius = std::max(0.0, std::min(std::min(blocker.width, blocker.height) * 0.5, blocker.radius));
  if (radius <= 0) {
    return false;
  }
  const double right = blocker.x + blocker.width;
  const double bottom = blocker.y + blocker.height;
  if ((blocker.cornerMask & 1) &&
      x < blocker.x + radius &&
      y < blocker.y + radius &&
      hypot2(x - (blocker.x + radius), y - (blocker.y + radius)) > radius) {
    return true;
  }
  if ((blocker.cornerMask & 2) &&
      x > right - radius &&
      y < blocker.y + radius &&
      hypot2(x - (right - radius), y - (blocker.y + radius)) > radius) {
    return true;
  }
  if ((blocker.cornerMask & 4) &&
      x > right - radius &&
      y > bottom - radius &&
      hypot2(x - (right - radius), y - (bottom - radius)) > radius) {
    return true;
  }
  return (blocker.cornerMask & 8) &&
    x < blocker.x + radius &&
    y > bottom - radius &&
    hypot2(x - (blocker.x + radius), y - (bottom - radius)) > radius;
}

bool pointOverlapsBlockerShape(double x, double y, const Blocker& blocker) {
  const double right = blocker.x + blocker.width;
  const double bottom = blocker.y + blocker.height;
  if (x < blocker.x || x > right || y < blocker.y || y > bottom) {
    return false;
  }
  if (blocker.radius <= 0 || blocker.cornerMask == 0) {
    return true;
  }
  return !pointInRoundedCutout(x, y, blocker);
}

int roundedPrimitives(const Blocker& blocker, Primitive* primitives) {
  const double radius = std::max(0.0, std::min(std::min(blocker.width, blocker.height) * 0.5, blocker.radius));
  if (radius <= 0 || blocker.cornerMask == 0) {
    primitives[0] = {0, blocker.x, blocker.y, blocker.width, blocker.height, 0};
    return 1;
  }

  int count = 0;
  const double right = blocker.x + blocker.width;
  const double bottom = blocker.y + blocker.height;
  const double centerWidth = std::max(0.0, blocker.width - radius * 2);
  const double centerHeight = std::max(0.0, blocker.height - radius * 2);
  if (centerWidth > 0) {
    primitives[count++] = {0, blocker.x + radius, blocker.y, centerWidth, blocker.height, 0};
  }
  if (centerHeight > 0) {
    primitives[count++] = {0, blocker.x, blocker.y + radius, blocker.width, centerHeight, 0};
  }

  auto addCorner = [&](int mask, double rectX, double rectY, double circleX, double circleY) {
    if (blocker.cornerMask & mask) {
      primitives[count++] = {1, circleX, circleY, 0, 0, radius};
    } else {
      primitives[count++] = {0, rectX, rectY, radius, radius, 0};
    }
  };

  addCorner(1, blocker.x, blocker.y, blocker.x + radius, blocker.y + radius);
  addCorner(2, right - radius, blocker.y, right - radius, blocker.y + radius);
  addCorner(4, right - radius, bottom - radius, right - radius, bottom - radius);
  addCorner(8, blocker.x, bottom - radius, blocker.x + radius, bottom - radius);
  return count;
}

double pointDistanceToPrimitive(double x, double y, const Primitive& primitive) {
  if (primitive.type == 1) {
    return std::max(0.0, hypot2(x - primitive.x, y - primitive.y) - primitive.radius);
  }
  const Blocker bounds{primitive.x, primitive.y, primitive.width, primitive.height, 0, 0};
  return pointDistanceToBounds(x, y, bounds);
}

double pointDistanceToBlockerShape(double x, double y, const Blocker& blocker) {
  if (blocker.radius <= 0 || blocker.cornerMask == 0) {
    return pointDistanceToBounds(x, y, blocker);
  }
  if (pointOverlapsBlockerShape(x, y, blocker)) {
    return -pointInsideBoundsDepth(x, y, blocker);
  }

  Primitive primitives[6];
  const int count = roundedPrimitives(blocker, primitives);
  double distance = INFINITY;
  for (int index = 0; index < count; ++index) {
    distance = std::min(distance, pointDistanceToPrimitive(x, y, primitives[index]));
  }
  return distance;
}

bool circleOverlapsBlocker(double x, double y, double radius, const Blocker& blocker) {
  return pointDistanceToBlockerShape(x, y, blocker) < radius;
}

double trajectoryClearance(
  double x,
  double y,
  double radius,
  const Blocker* blockers,
  int blockerCount,
  double scanPixels
) {
  double clearance = scanPixels;
  for (int index = 0; index < blockerCount; ++index) {
    const Blocker& blocker = blockers[index];
    const double rejectDistance = radius + clearance;
    const double broadDistance = pointDistanceToBounds(x, y, blocker);
    if (broadDistance * broadDistance > rejectDistance * rejectDistance) {
      continue;
    }
    const double distance = pointDistanceToBlockerShape(x, y, blocker);
    clearance = std::min(clearance, distance - radius);
  }
  return clearance;
}

bool segmentHitsBlockingTile(
  double startX,
  double startY,
  double endX,
  double endY,
  double radius,
  const Blocker* blockers,
  int blockerCount
) {
  const double dx = endX - startX;
  const double dy = endY - startY;
  for (int blockerIndex = 0; blockerIndex < blockerCount; ++blockerIndex) {
    const Blocker& blocker = blockers[blockerIndex];
    if (circleOverlapsBlocker(startX, startY, radius, blocker)) {
      return true;
    }
    if (circleOverlapsBlocker(endX, endY, radius, blocker)) {
      return true;
    }
    for (int step = 1; step <= 6; ++step) {
      const double t = static_cast<double>(step) / 7.0;
      if (circleOverlapsBlocker(startX + dx * t, startY + dy * t, radius, blocker)) {
        return true;
      }
    }
  }
  return false;
}

void addControl(Control* controls, int& count, double x, double y, int thrust, double desiredX, double desiredY) {
  if (count >= kMaxCandidates) {
    return;
  }
  if (thrust > 0 && x * desiredX + y * desiredY < -0.0001) {
    return;
  }
  const int keyX = static_cast<int>(std::round(x * 1000));
  const int keyY = static_cast<int>(std::round(y * 1000));
  for (int index = 0; index < count; ++index) {
    if (
      static_cast<int>(std::round(controls[index].x * 1000)) == keyX &&
      static_cast<int>(std::round(controls[index].y * 1000)) == keyY &&
      controls[index].thrust == thrust
    ) {
      return;
    }
  }
  controls[count++] = {x, y, thrust};
}

int trajectoryCandidateControls(Control* controls, double desiredX, double desiredY, double vx, double vy) {
  int count = 0;
  addControl(controls, count, 0, 0, 0, desiredX, desiredY);
  const double baseAngle = std::atan2(desiredY, desiredX);
  const double pi = std::acos(-1);
  const double offsets[] = {
    0,
    -pi / 18, pi / 18,
    -pi / 9, pi / 9,
    -pi / 6, pi / 6,
    -pi / 4, pi / 4,
    -pi / 3, pi / 3,
    -pi / 2, pi / 2
  };
  for (double offset : offsets) {
    const double angle = baseAngle + offset;
    addControl(controls, count, std::cos(angle), std::sin(angle), 1, desiredX, desiredY);
  }
  if (hypot2(vx, vy) > 0.01) {
    const double velocityAngle = std::atan2(vy, vx);
    addControl(controls, count, std::cos(velocityAngle + pi / 2), std::sin(velocityAngle + pi / 2), 1, desiredX, desiredY);
    addControl(controls, count, std::cos(velocityAngle - pi / 2), std::sin(velocityAngle - pi / 2), 1, desiredX, desiredY);
  }
  for (int index = 0; index < 8; ++index) {
    const double angle = index * pi / 4;
    addControl(controls, count, std::cos(angle), std::sin(angle), 1, desiredX, desiredY);
  }
  return count;
}

State stepTrajectoryState(
  const State& state,
  int previousIndex,
  const Control& control,
  double desiredX,
  double desiredY,
  double radius,
  double acceleration,
  double friction,
  double dt,
  int step,
  const Blocker* blockers,
  int blockerCount,
  double scanPixels,
  double softClearancePixels,
  double progressWeight,
  double alignmentWeight,
  double clearanceWeight,
  double lateHitWeight
) {
  const double moveX = control.thrust > 0 ? control.x : 0;
  const double moveY = control.thrust > 0 ? control.y : 0;
  const double frictionVx = state.vx * friction;
  const double frictionVy = state.vy * friction;
  const double thrustVx = moveX * acceleration * dt;
  const double thrustVy = moveY * acceleration * dt;
  const double vx = frictionVx + thrustVx;
  const double vy = frictionVy + thrustVy;
  const double nextX = state.x + vx * dt;
  const double nextY = state.y + vy * dt;
  const double momentumProgress = frictionVx * desiredX + frictionVy * desiredY;
  const double thrustProgress = thrustVx * desiredX + thrustVy * desiredY;
  const double clearance = trajectoryClearance(nextX, nextY, radius, blockers, blockerCount, scanPixels);
  const double previousClearance = std::isfinite(state.clearance) ? state.clearance : state.minClearance;
  const bool recovering = state.recovering && previousClearance < 0;
  const double segmentDx = nextX - state.x;
  const double segmentDy = nextY - state.y;
  const double segmentLength = hypot2(segmentDx, segmentDy);
  const bool segmentHit = !recovering && segmentLength > std::max(0.0, previousClearance)
    ? segmentHitsBlockingTile(state.x, state.y, nextX, nextY, radius, blockers, blockerCount)
    : false;
  const double progress = segmentDx * desiredX + segmentDy * desiredY;
  const double alignment = moveX * desiredX + moveY * desiredY;
  const double recoveryImprovement = clearance - previousClearance;
  const bool recoveryProgress = progress > 0.002;
  const bool recoverySafe = recoveryImprovement >= -0.05 && recoveryProgress;
  const bool safe = state.safe && (recovering ? recoverySafe : (!segmentHit && clearance >= 0));
  const bool stillRecovering = safe && clearance < 0;
  const int hitStep = safe ? state.hitStep : std::min(state.hitStep, step);
  const double softClearance = clearance - softClearancePixels;
  const double clearanceScore = clampDouble(clearance, -scanPixels, scanPixels);
  const double softClearancePenalty = softClearance < 0 ? softClearance * softClearance * -2.5 : 0;
  const double safetyScore = safe ? 75 : -1000 + hitStep * lateHitWeight;
  const double recoveryScore = recovering ? recoveryImprovement * 160 : 0;
  const double stepScore =
    progress * progressWeight +
    alignment * alignmentWeight +
    momentumProgress * 0.015 +
    thrustProgress * 0.06 +
    clearanceScore * clearanceWeight +
    recoveryScore +
    softClearancePenalty +
    safetyScore;

  State next;
  next.x = nextX;
  next.y = nextY;
  next.vx = vx;
  next.vy = vy;
  next.firstMoveX = state.hasMove ? state.firstMoveX : moveX;
  next.firstMoveY = state.hasMove ? state.firstMoveY : moveY;
  next.moveX = moveX;
  next.moveY = moveY;
  next.previous = previousIndex;
  next.score = state.score + stepScore;
  next.safe = safe ? 1 : 0;
  next.recovering = stillRecovering ? 1 : 0;
  next.hitStep = hitStep;
  next.clearance = clearance;
  next.minClearance = std::min(state.minClearance, clearance);
  next.hasMove = 1;
  return next;
}

} // namespace

BS_EXPORT int bs_core_version() {
  return 1;
}

BS_EXPORT int bs_plan_trajectory(
  const double* blockerData,
  int blockerCount,
  double x,
  double y,
  double vx,
  double vy,
  double desiredX,
  double desiredY,
  double radius,
  double acceleration,
  double friction,
  double dt,
  int steps,
  int beamWidth,
  double scanPixels,
  double softClearancePixels,
  double progressWeight,
  double alignmentWeight,
  double clearanceWeight,
  double lateHitWeight,
  double maxOvershootSpeed,
  double* out
) {
  if (!out) {
    return 0;
  }
  out[0] = 0;
  out[1] = 0;

  const double desiredLength = hypot2(desiredX, desiredY);
  if (desiredLength <= 0.0001 || blockerCount < 0 || !blockerData) {
    return 0;
  }
  desiredX /= desiredLength;
  desiredY /= desiredLength;
  steps = std::max(1, std::min(kMaxSteps, steps));
  beamWidth = std::max(1, std::min(kMaxBeam, beamWidth));

  std::vector<Blocker> blockers;
  blockers.reserve(static_cast<size_t>(blockerCount));
  for (int index = 0; index < blockerCount; ++index) {
    const double* row = blockerData + index * 6;
    blockers.push_back({
      row[0],
      row[1],
      row[2],
      row[3],
      row[4],
      static_cast<int>(std::round(row[5]))
    });
  }

  Control controls[kMaxCandidates];
  const int controlCount = trajectoryCandidateControls(controls, desiredX, desiredY, vx, vy);
  if (controlCount <= 0) {
    return 0;
  }

  std::vector<State> states;
  states.reserve(kMaxStoredStates);
  std::vector<int> beam;
  beam.reserve(kMaxBeam * kMaxCandidates);
  std::vector<int> nextBeam;
  nextBeam.reserve(kMaxBeam * kMaxCandidates);

  const double initialClearance = trajectoryClearance(
    x,
    y,
    radius,
    blockers.data(),
    static_cast<int>(blockers.size()),
    scanPixels
  );
  State initial;
  initial.x = x;
  initial.y = y;
  initial.vx = vx;
  initial.vy = vy;
  initial.hitStep = steps + 1;
  initial.clearance = initialClearance;
  initial.minClearance = initialClearance;
  initial.recovering = initialClearance < 0 ? 1 : 0;
  states.push_back(initial);
  beam.push_back(0);

  for (int step = 1; step <= steps; ++step) {
    nextBeam.clear();
    for (const int stateIndex : beam) {
      const State& state = states[static_cast<size_t>(stateIndex)];
      for (int controlIndex = 0; controlIndex < controlCount; ++controlIndex) {
        if (static_cast<int>(states.size()) >= kMaxStoredStates) {
          break;
        }
        states.push_back(stepTrajectoryState(
          state,
          stateIndex,
          controls[controlIndex],
          desiredX,
          desiredY,
          radius,
          acceleration,
          friction,
          dt,
          step,
          blockers.data(),
          static_cast<int>(blockers.size()),
          scanPixels,
          softClearancePixels,
          progressWeight,
          alignmentWeight,
          clearanceWeight,
          lateHitWeight
        ));
        nextBeam.push_back(static_cast<int>(states.size()) - 1);
      }
    }

    std::sort(nextBeam.begin(), nextBeam.end(), [&](int a, int b) {
      return states[static_cast<size_t>(a)].score > states[static_cast<size_t>(b)].score;
    });
    if (static_cast<int>(nextBeam.size()) > beamWidth) {
      nextBeam.resize(static_cast<size_t>(beamWidth));
    }
    beam = nextBeam;
  }

  int selected = -1;
  if (hypot2(vx, vy) <= maxOvershootSpeed) {
    for (int stateIndex : beam) {
      const State& state = states[static_cast<size_t>(stateIndex)];
      if (!state.safe) {
        continue;
      }
      if (hypot2(state.firstMoveX, state.firstMoveY) > 0.0001) {
        selected = stateIndex;
        break;
      }
    }
  }
  if (selected < 0) {
    for (int stateIndex : beam) {
      const State& state = states[static_cast<size_t>(stateIndex)];
      if (!state.safe) {
        continue;
      }
      if (selected < 0 || state.score > states[static_cast<size_t>(selected)].score) {
        selected = stateIndex;
      }
    }
  }
  if (selected < 0) {
    return 0;
  }

  std::vector<State> path;
  for (int cursor = selected; cursor >= 0;) {
    const State& state = states[static_cast<size_t>(cursor)];
    if (state.hasMove) {
      path.push_back(state);
    }
    cursor = state.previous;
  }
  std::reverse(path.begin(), path.end());

  const int moveCount = std::min(static_cast<int>(path.size()), kMaxSteps);
  out[0] = 1;
  out[1] = moveCount;
  out[2] = states[static_cast<size_t>(selected)].score;
  out[3] = states[static_cast<size_t>(selected)].minClearance;
  for (int index = 0; index < moveCount; ++index) {
    out[4 + index * 2] = path[static_cast<size_t>(index)].moveX;
    out[5 + index * 2] = path[static_cast<size_t>(index)].moveY;
  }
  return 1;
}

BS_EXPORT int bs_find_path(
  const uint8_t* tiles,
  const uint8_t* playable,
  const uint8_t* storm,
  const uint8_t* amounts,
  const float* miningProgress,
  int width,
  int height,
  double tileSize,
  int startIndex,
  int goalIndex,
  int allowMining,
  int allowUnsafeStorm,
  int allowUnsafeStart,
  int pathLimitToView,
  double viewOriginX,
  double viewOriginY,
  double viewRadius,
  double pathAirSpeed,
  double pathMiningPower,
  double pathMiningCostMultiplier,
  double pathMiningExtraSeconds,
  double rockSeconds,
  double oreSeconds,
  double diamondSeconds,
  double stormTileSeconds,
  int stormClearanceTilesValue,
  double stormEdgeSeconds,
  int hasEnemyDanger,
  double enemyDangerX,
  double enemyDangerY,
  double enemyDangerRadius,
  double enemyDangerScale,
  double enemyDangerMaxSeconds,
  int* outPath,
  int maxPathLength,
  double* outMeta
) {
  if (!tiles || !playable || !outPath || !outMeta || width <= 0 || height <= 0 || maxPathLength <= 0) {
    return 0;
  }

  const int tileCount = width * height;
  if (startIndex < 0 || startIndex >= tileCount || goalIndex < 0 || goalIndex >= tileCount) {
    return 0;
  }

  PathOptions options;
  options.width = width;
  options.height = height;
  options.tileSize = tileSize > 0 ? tileSize : 16;
  options.allowMining = allowMining;
  options.allowUnsafeStorm = allowUnsafeStorm;
  options.allowUnsafeStart = allowUnsafeStart;
  options.pathLimitToView = pathLimitToView;
  options.viewOriginX = viewOriginX;
  options.viewOriginY = viewOriginY;
  options.viewRadius = viewRadius;
  options.pathAirSpeed = pathAirSpeed;
  options.pathMiningPower = pathMiningPower;
  options.pathMiningCostMultiplier = pathMiningCostMultiplier;
  options.pathMiningExtraSeconds = pathMiningExtraSeconds;
  options.rockSeconds = rockSeconds;
  options.oreSeconds = oreSeconds;
  options.diamondSeconds = diamondSeconds;
  options.stormTileSeconds = stormTileSeconds;
  options.stormClearanceTiles = std::max(0, stormClearanceTilesValue);
  options.stormEdgeSeconds = stormEdgeSeconds;
  options.hasEnemyDanger = hasEnemyDanger;
  options.enemyDangerX = enemyDangerX;
  options.enemyDangerY = enemyDangerY;
  options.enemyDangerRadius = enemyDangerRadius;
  options.enemyDangerScale = enemyDangerScale;
  options.enemyDangerMaxSeconds = enemyDangerMaxSeconds;

  if (!pathTileAllowed(tiles, playable, storm, tileCount, startIndex, startIndex, options)) {
    return 0;
  }
  if (!pathTileAllowed(tiles, playable, storm, tileCount, goalIndex, startIndex, options)) {
    return 0;
  }

  if (startIndex == goalIndex) {
    outMeta[0] = 1;
    outMeta[1] = 0;
    outMeta[2] = 0;
    return 1;
  }

  const int stateCount = tileCount * kPathDirectionCount;
  PathScratch& scratch = pathScratch();
  if (static_cast<int>(scratch.previous.size()) < stateCount) {
    scratch.previous.resize(static_cast<size_t>(stateCount));
    scratch.costs.resize(static_cast<size_t>(stateCount));
    scratch.closed.resize(static_cast<size_t>(stateCount));
  }
  if (static_cast<int>(scratch.tileCosts.size()) < tileCount) {
    scratch.tileCosts.resize(static_cast<size_t>(tileCount));
  }
  std::fill(scratch.previous.begin(), scratch.previous.begin() + stateCount, -2);
  std::fill(scratch.costs.begin(), scratch.costs.begin() + stateCount, std::numeric_limits<float>::infinity());
  std::fill(scratch.closed.begin(), scratch.closed.begin() + stateCount, 0);
  std::fill(scratch.tileCosts.begin(), scratch.tileCosts.begin() + tileCount, -1.0f);
  int* previous = scratch.previous.data();
  float* costs = scratch.costs.data();
  uint8_t* closed = scratch.closed.data();
  float* tileCosts = scratch.tileCosts.data();
  std::priority_queue<PathOpenEntry, std::vector<PathOpenEntry>, PathOpenCompare> open;

  const int startState = pathStateId(startIndex, kPathStartDirection);
  previous[startState] = -1;
  costs[startState] = 0;
  open.push({startState, pathHeuristicSeconds(startIndex, goalIndex, options)});
  int endState = -1;
  int visited = 0;

  while (!open.empty()) {
    const PathOpenEntry entry = open.top();
    open.pop();
    const int currentState = entry.state;
    if (currentState < 0 || currentState >= stateCount || closed[currentState]) {
      continue;
    }

    closed[currentState] = 1;
    visited += 1;
    const int current = pathStateTile(currentState);
    const int currentDirection = pathStateDirection(currentState);
    if (current == goalIndex) {
      endState = currentState;
      break;
    }

    const int x = current % width;
    const int y = current / width;
    const int neighbors[4] = {
      x > 0 ? current - 1 : -1,
      x < width - 1 ? current + 1 : -1,
      y > 0 ? current - width : -1,
      y < height - 1 ? current + width : -1
    };

    for (int neighborIndex = 0; neighborIndex < 4; ++neighborIndex) {
      const int neighbor = neighbors[neighborIndex];
      if (neighbor < 0 || !pathTileAllowed(tiles, playable, storm, tileCount, neighbor, startIndex, options)) {
        continue;
      }
      const int direction = pathDirectionBetween(width, current, neighbor);
      const int neighborState = pathStateId(neighbor, direction);
      if (closed[neighborState]) {
        continue;
      }
      if (tileCosts[neighbor] < 0) {
        tileCosts[neighbor] = static_cast<float>(
          pathTileCostSeconds(tiles, amounts, storm, miningProgress, tileCount, neighbor, options)
        );
      }
      const double nextCost = costs[currentState] + tileCosts[neighbor];
      if (nextCost >= costs[neighborState]) {
        continue;
      }
      costs[neighborState] = static_cast<float>(nextCost);
      previous[neighborState] = currentState;
      open.push({
        neighborState,
        nextCost + pathHeuristicSeconds(neighbor, goalIndex, options)
      });
    }
  }

  if (endState < 0) {
    outMeta[0] = 0;
    outMeta[1] = 0;
    outMeta[2] = visited;
    return 0;
  }

  std::vector<int> reversed;
  for (int current = endState; current != startState && current >= 0;) {
    reversed.push_back(pathStateTile(current));
    current = previous[current];
  }
  std::reverse(reversed.begin(), reversed.end());
  const int pathLength = std::min(static_cast<int>(reversed.size()), maxPathLength);
  for (int index = 0; index < pathLength; ++index) {
    outPath[index] = reversed[static_cast<size_t>(index)];
  }

  outMeta[0] = 1;
  outMeta[1] = pathLength;
  outMeta[2] = costs[endState];
  outMeta[3] = visited;
  return 1;
}

BS_EXPORT int bs_visibility_spans(
  const double* segmentData,
  int segmentCount,
  double originX,
  double originY,
  double radius,
  int baseRays,
  double angleEpsilon,
  int dilatePixels,
  int* outRows,
  int maxRows,
  int* outSpans,
  int maxSpanInts,
  double* outMeta
) {
  if ((!segmentData && segmentCount > 0) || !outRows || !outSpans || !outMeta || segmentCount < 0 || radius <= 0 || maxRows <= 0 || maxSpanInts <= 0) {
    return 0;
  }

  outMeta[0] = 0;
  outMeta[1] = 0;
  outMeta[2] = 0;
  outMeta[3] = 0;

  const double pi = std::acos(-1);
  const double fullCircle = pi * 2;
  std::vector<VisibilitySegment> segments;
  segments.reserve(static_cast<size_t>(segmentCount));
  std::vector<VisibilityEvent> events;
  events.reserve(static_cast<size_t>(segmentCount) * 2);
  std::vector<double> samples;
  samples.reserve(static_cast<size_t>(std::max(0, baseRays)) + static_cast<size_t>(segmentCount) * 6);

  for (int index = 0; index < segmentCount; ++index) {
    const double* row = segmentData + index * 4;
    const double x0 = row[0];
    const double y0 = row[1];
    const double x1 = row[2];
    const double y1 = row[3];
    if (x0 == x1 && y0 == y1) {
      continue;
    }

    const double angle0 = normalizeAngle(std::atan2(y0 - originY, x0 - originX));
    const double angle1 = normalizeAngle(std::atan2(y1 - originY, x1 - originX));
    double startAngle = angle0;
    double span = normalizeAngle(angle1 - angle0);
    if (span < 0.000001) {
      continue;
    }
    if (span > pi) {
      startAngle = angle1;
      span = fullCircle - span;
    }

    const double endAngle = normalizeAngle(startAngle + span);
    const int segmentIndex = static_cast<int>(segments.size());
    segments.push_back({x0, y0, x1, y1, startAngle, endAngle, endAngle < startAngle ? 1 : 0});
    events.push_back({startAngle, segmentIndex, 1});
    events.push_back({endAngle, segmentIndex, 0});
  }

  if (segments.empty()) {
    const int offsetY = static_cast<int>(std::floor(originY - radius)) - 1 - std::max(0, dilatePixels);
    const int endY = static_cast<int>(std::ceil(originY + radius)) + 1 + std::max(0, dilatePixels);
    const int rowCount = endY - offsetY + 1;
    if (rowCount <= 0 || rowCount > maxRows || rowCount * 2 > maxSpanInts) {
      return 0;
    }
    int spanWrite = 0;
    for (int row = 0; row < rowCount; ++row) {
      const double y = offsetY + row + 0.5;
      const double dy = y - originY;
      const double halfWidthSq = radius * radius - dy * dy;
      if (halfWidthSq < 0) {
        outRows[row * 2] = spanWrite;
        outRows[row * 2 + 1] = 0;
        continue;
      }
      const double halfWidth = std::sqrt(halfWidthSq);
      outRows[row * 2] = spanWrite;
      outRows[row * 2 + 1] = 2;
      outSpans[spanWrite++] = static_cast<int>(std::ceil(originX - halfWidth - 0.5));
      outSpans[spanWrite++] = static_cast<int>(std::floor(originX + halfWidth - 0.5)) + 1;
    }
    outMeta[0] = 1;
    outMeta[1] = offsetY;
    outMeta[2] = rowCount;
    outMeta[3] = spanWrite;
    return 1;
  }

  std::sort(events.begin(), events.end(), [](const VisibilityEvent& a, const VisibilityEvent& b) {
    return a.angle < b.angle;
  });

  baseRays = std::max(16, baseRays);
  for (int index = 0; index < baseRays; ++index) {
    samples.push_back(fullCircle * static_cast<double>(index) / static_cast<double>(baseRays));
  }
  for (const VisibilityEvent& event : events) {
    addVisibilitySample(samples, event.angle - angleEpsilon);
    addVisibilitySample(samples, event.angle);
    addVisibilitySample(samples, event.angle + angleEpsilon);
  }
  std::sort(samples.begin(), samples.end());
  samples.erase(std::unique(samples.begin(), samples.end(), [](double a, double b) {
    return std::abs(a - b) < 0.000001;
  }), samples.end());

  std::vector<uint8_t> active(segments.size(), 0);
  for (int index = 0; index < static_cast<int>(segments.size()); ++index) {
    if (segments[static_cast<size_t>(index)].wraps) {
      active[static_cast<size_t>(index)] = 1;
    }
  }

  std::vector<VisibilityPoint> points;
  points.reserve(samples.size());
  int eventIndex = 0;
  for (const double angle : samples) {
    applyVisibilityEvents(events, eventIndex, angle, active);
    int groupStart = -1;
    int groupEnd = -1;
    visibilityEventGroupRange(events, eventIndex, angle, groupStart, groupEnd);

    const double dirX = std::cos(angle);
    const double dirY = std::sin(angle);
    double nearest = radius;
    for (int segmentIndex = 0; segmentIndex < static_cast<int>(segments.size()); ++segmentIndex) {
      if (!active[static_cast<size_t>(segmentIndex)]) {
        continue;
      }
      const double distance = rayVisibilitySegmentDistance(originX, originY, dirX, dirY, segments[static_cast<size_t>(segmentIndex)]);
      if (distance >= 0 && distance < nearest) {
        nearest = distance;
      }
    }
    for (int index = groupStart; index >= 0 && index < groupEnd; ++index) {
      const int segmentIndex = events[static_cast<size_t>(index)].segmentIndex;
      const double distance = rayVisibilitySegmentDistance(originX, originY, dirX, dirY, segments[static_cast<size_t>(segmentIndex)]);
      if (distance >= 0 && distance < nearest) {
        nearest = distance;
      }
    }
    nearest = clampDouble(nearest, 0, radius);
    points.push_back({originX + dirX * nearest, originY + dirY * nearest});
  }

  if (points.size() < 3) {
    return 0;
  }

  double minY = std::numeric_limits<double>::infinity();
  double maxY = -std::numeric_limits<double>::infinity();
  for (const VisibilityPoint& point : points) {
    minY = std::min(minY, point.y);
    maxY = std::max(maxY, point.y);
  }
  const int padding = std::max(0, dilatePixels);
  const int sourceOffsetY = static_cast<int>(std::floor(minY)) - 1;
  const int sourceEndY = static_cast<int>(std::ceil(maxY)) + 1;
  const int sourceRows = sourceEndY - sourceOffsetY + 1;
  const int offsetY = sourceOffsetY - padding;
  const int rowCount = sourceRows + padding * 2;
  if (sourceRows <= 0 || rowCount <= 0 || rowCount > maxRows) {
    return 0;
  }

  std::vector<std::vector<std::pair<int, int>>> rows(static_cast<size_t>(rowCount));
  std::vector<double> intersections;
  intersections.reserve(points.size());
  for (int y = sourceOffsetY; y <= sourceEndY; ++y) {
    const double scanY = static_cast<double>(y) + 0.5;
    intersections.clear();
    for (int index = 0; index < static_cast<int>(points.size()); ++index) {
      const VisibilityPoint& a = points[static_cast<size_t>(index)];
      const VisibilityPoint& b = points[static_cast<size_t>((index + 1) % points.size())];
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
        const double t = (scanY - a.y) / (b.y - a.y);
        intersections.push_back(a.x + (b.x - a.x) * t);
      }
    }
    if (intersections.size() < 2) {
      continue;
    }
    std::sort(intersections.begin(), intersections.end());
    std::vector<std::pair<int, int>> sourceSpans;
    for (int index = 0; index + 1 < static_cast<int>(intersections.size()); index += 2) {
      const int start = static_cast<int>(std::ceil(intersections[static_cast<size_t>(index)] - 0.5));
      const int end = static_cast<int>(std::floor(intersections[static_cast<size_t>(index + 1)] - 0.5)) + 1;
      if (end > start) {
        sourceSpans.push_back({start, end});
      }
    }
    if (sourceSpans.empty()) {
      continue;
    }

    const int sourceRow = y - sourceOffsetY;
    for (int dy = -padding; dy <= padding; ++dy) {
      const int row = sourceRow + padding + dy;
      if (row < 0 || row >= rowCount) {
        continue;
      }
      for (const auto& span : sourceSpans) {
        rows[static_cast<size_t>(row)].push_back({span.first - padding, span.second + padding});
      }
    }
  }

  int spanWrite = 0;
  for (int row = 0; row < rowCount; ++row) {
    auto& pairs = rows[static_cast<size_t>(row)];
    mergeSpanPairs(pairs);
    outRows[row * 2] = spanWrite;
    outRows[row * 2 + 1] = static_cast<int>(pairs.size()) * 2;
    if (spanWrite + static_cast<int>(pairs.size()) * 2 > maxSpanInts) {
      return 0;
    }
    for (const auto& pair : pairs) {
      outSpans[spanWrite++] = pair.first;
      outSpans[spanWrite++] = pair.second;
    }
  }

  outMeta[0] = 1;
  outMeta[1] = offsetY;
  outMeta[2] = rowCount;
  outMeta[3] = spanWrite;
  outMeta[4] = static_cast<double>(points.size());
  outMeta[5] = static_cast<double>(segments.size());
  return 1;
}

BS_EXPORT int bs_visibility_spans_from_grid(
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  double tileSize,
  double cameraX,
  double cameraY,
  double playerX,
  double playerY,
  double radius,
  int minTileX,
  int maxTileX,
  int minTileY,
  int maxTileY,
  int baseRays,
  double angleEpsilon,
  int dilatePixels,
  int outerBevel,
  int innerCorner,
  int edgeOverlap,
  int* outRows,
  int maxRows,
  int* outSpans,
  int maxSpanInts,
  double* outMeta
) {
  if (!tiles || !playable || !outRows || !outSpans || !outMeta || width <= 0 || height <= 0 || tileSize <= 0 || radius <= 0) {
    return 0;
  }

  minTileX = std::max(0, std::min(width - 1, minTileX));
  maxTileX = std::max(0, std::min(width - 1, maxTileX));
  minTileY = std::max(0, std::min(height - 1, minTileY));
  maxTileY = std::max(0, std::min(height - 1, maxTileY));
  if (minTileX > maxTileX || minTileY > maxTileY) {
    return 0;
  }

  outerBevel = std::max(0, outerBevel);
  innerCorner = std::max(0, innerCorner);
  edgeOverlap = std::max(0, edgeOverlap);
  const double radiusSq = radius * radius;
  std::vector<double> segmentData;
  const int boundTileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
  segmentData.reserve(static_cast<size_t>(std::max(32, boundTileCount)) * 8);

  for (int tileY = minTileY; tileY <= maxTileY; ++tileY) {
    for (int tileX = minTileX; tileX <= maxTileX; ++tileX) {
      const int blockerKind = visibilityBlockerKind(tiles, playable, width, height, tileX, tileY);
      if (!blockerKind) {
        continue;
      }

      const double left = static_cast<double>(tileX) * tileSize;
      const double top = static_cast<double>(tileY) * tileSize;
      if (!visibilityTileRectTouchesCircleWorld(left, top, tileSize, playerX, playerY, radiusSq)) {
        continue;
      }

      if (blockerKind == 1) {
        addGridVisibilityRockSegments(
          segmentData,
          tiles,
          playable,
          width,
          height,
          tileX,
          tileY,
          left,
          top,
          tileSize,
          cameraX,
          cameraY,
          outerBevel,
          innerCorner,
          edgeOverlap
        );
      } else {
        addGridVisibilitySquareSegments(
          segmentData,
          tiles,
          playable,
          width,
          height,
          tileX,
          tileY,
          left,
          top,
          tileSize,
          cameraX,
          cameraY
        );
      }
    }
  }

  addGridVisibilityInnerCornerSegments(
    segmentData,
    tiles,
    playable,
    width,
    height,
    minTileX,
    maxTileX,
    minTileY,
    maxTileY,
    playerX,
    playerY,
    radiusSq,
    tileSize,
    cameraX,
    cameraY,
    innerCorner
  );

  const int segmentCount = static_cast<int>(segmentData.size() / 4);
  return bs_visibility_spans(
    segmentData.empty() ? nullptr : segmentData.data(),
    segmentCount,
    playerX - cameraX,
    playerY - cameraY,
    radius,
    baseRays,
    angleEpsilon,
    dilatePixels,
    outRows,
    maxRows,
    outSpans,
    maxSpanInts,
    outMeta
  );
}

BS_EXPORT int bs_storm_pattern_rows(
  uint32_t seedHash,
  int tileX,
  int tileY,
  int size,
  int frame,
  double fps,
  double threshold,
  double scale,
  double speedX,
  double speedY,
  double speedZ,
  uint32_t* outRows
) {
  if (!outRows || size <= 0 || size > 32 || fps <= 0 || scale <= 0) {
    return 0;
  }

  const double timeSeconds = static_cast<double>(frame) / fps;
  const int worldLeft = tileX * size;
  const int worldTop = tileY * size;
  for (int py = 0; py < size; ++py) {
    uint32_t row = 0;
    for (int px = 0; px < size; ++px) {
      const double sampleX = (static_cast<double>(worldLeft + px) + timeSeconds * speedX) * scale;
      const double sampleY = (static_cast<double>(worldTop + py) + timeSeconds * speedY) * scale;
      const double sampleZ = timeSeconds * speedZ;
      if (stormVisualNoise(sampleX, sampleY, sampleZ, seedHash) >= threshold) {
        row |= (1U << static_cast<uint32_t>(px));
      }
    }
    outRows[py] = row;
  }

  return 1;
}
