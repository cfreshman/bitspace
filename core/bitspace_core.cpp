#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <queue>
#include <unordered_map>
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
constexpr int kHuckRockPointCount = 14;
constexpr int kSimplexGradientCount = 12;
constexpr double kRaycastStepPixels = 0.5;
constexpr double kRockCollisionCornerRadiusScale = 1.0 / 3.0;
constexpr int kStormPatternRowCacheMax = 65536;

constexpr int kSimplexGradients3D[kSimplexGradientCount][3] = {
  {1, 1, 0},
  {-1, 1, 0},
  {1, -1, 0},
  {-1, -1, 0},
  {1, 0, 1},
  {-1, 0, 1},
  {1, 0, -1},
  {-1, 0, -1},
  {0, 1, 1},
  {0, -1, 1},
  {0, 1, -1},
  {0, -1, -1}
};

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

struct HullPoint {
  double x = 0;
  double y = 0;
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

uint32_t mixUint32(uint32_t value) {
  value ^= value >> 16;
  value *= 2246822519U;
  value ^= value >> 13;
  value *= 3266489917U;
  value ^= value >> 16;
  return value;
}

struct StormPatternRowKey {
  uint32_t permHash = 0;
  int tileX = 0;
  int tileY = 0;
  int localY = 0;
  int size = 0;
  int threshold = 0;
  int fps = 0;
  int scale = 0;
  int speedX = 0;
  int speedY = 0;
  int speedZ = 0;

  bool operator==(const StormPatternRowKey& other) const {
    return permHash == other.permHash &&
      tileX == other.tileX &&
      tileY == other.tileY &&
      localY == other.localY &&
      size == other.size &&
      threshold == other.threshold &&
      fps == other.fps &&
      scale == other.scale &&
      speedX == other.speedX &&
      speedY == other.speedY &&
      speedZ == other.speedZ;
  }
};

struct StormPatternRowKeyHash {
  std::size_t operator()(const StormPatternRowKey& key) const {
    uint32_t hash = key.permHash ^ 2166136261U;
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.tileX));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.tileY));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.localY));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.size));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.threshold));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.fps));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.scale));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.speedX));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.speedY));
    hash = mixUint32(hash ^ static_cast<uint32_t>(key.speedZ));
    return static_cast<std::size_t>(hash);
  }
};

std::unordered_map<StormPatternRowKey, uint32_t, StormPatternRowKeyHash> gStormPatternRowCache;
int gStormPatternRowCacheFrame = std::numeric_limits<int>::min();

struct LensProjectionEntry {
  int baseX = 0;
  int baseY = 0;
  int defectX = 0;
  int defectY = 0;
  uint8_t baseValid = 0;
  uint8_t defectPresent = 0;
  uint8_t defectValid = 0;
};

struct LensProjectionCacheConfig {
  int screenWidth = 0;
  int screenHeight = 0;
  int padding = 0;
  int edgeScale = 0;
  int power = 0;
  int noiseRadial = 0;
  int noiseTangential = 0;
  int defectDensity = 0;
};

std::vector<LensProjectionEntry> gLensProjectionCache;
LensProjectionCacheConfig gLensProjectionCacheConfig;
bool gLensProjectionCacheReady = false;

double randomUnit32(uint32_t seed, int salt) {
  uint32_t value = seed ^ (static_cast<uint32_t>(salt + 1) * 374761393U);
  value *= 668265263U;
  return static_cast<double>(mixUint32(value)) / 4294967296.0;
}

uint32_t lensNoiseUint(int x, int y, uint32_t salt) {
  uint32_t value = static_cast<uint32_t>(x) * 374761393U;
  value ^= static_cast<uint32_t>(y) * 668265263U;
  value ^= salt;
  value = (value ^ (value >> 13)) * 1274126177U;
  value = (value ^ (value >> 16)) * 2246822519U;
  return value ^ (value >> 15);
}

double lensNoiseUnitAt(int x, int y, uint32_t salt) {
  return static_cast<double>(lensNoiseUint(x, y, salt)) / 4294967295.0;
}

int floorInt(double value) {
  return static_cast<int>(std::floor(value));
}

int floorDivInt(int value, int divisor) {
  if (divisor <= 0) {
    return 0;
  }
  int quotient = value / divisor;
  const int remainder = value % divisor;
  if (remainder != 0 && ((remainder < 0) != (divisor < 0))) {
    quotient -= 1;
  }
  return quotient;
}

int positiveModuloInt(int value, int modulus) {
  if (modulus <= 0) {
    return 0;
  }
  int result = value % modulus;
  return result < 0 ? result + modulus : result;
}

double roundedHundredth(double value) {
  return std::round(value * 100.0) / 100.0;
}

double hullCross(const HullPoint& origin, const HullPoint& a, const HullPoint& b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

bool isMineableTile(uint8_t tile) {
  return tile == 1 || tile == 2 || tile == 3 || tile == 4;
}

bool isRenderSolidTile(uint8_t tile) {
  return tile == 1 || tile == 2 || tile == 3 || tile == 4;
}

bool isRockCollisionTile(uint8_t tile) {
  return tile == 1 || tile == 2 || tile == 3;
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

double simplexCorner(
  const uint8_t* perm,
  int ii,
  int jj,
  int kk,
  int i,
  int j,
  int k,
  double x,
  double y,
  double z
) {
  double influence = 0.6 - x * x - y * y - z * z;
  if (influence < 0) {
    return 0;
  }

  const int gradientIndex = perm[ii + i + perm[jj + j + perm[kk + k]]] % kSimplexGradientCount;
  const int* gradient = kSimplexGradients3D[gradientIndex];
  influence *= influence;
  return influence * influence * (
    static_cast<double>(gradient[0]) * x +
    static_cast<double>(gradient[1]) * y +
    static_cast<double>(gradient[2]) * z
  );
}

double simplexNoise3D(const uint8_t* perm, double x, double y, double z) {
  const double skew = (x + y + z) / 3.0;
  const int i = static_cast<int>(std::floor(x + skew));
  const int j = static_cast<int>(std::floor(y + skew));
  const int k = static_cast<int>(std::floor(z + skew));
  const double unskew = static_cast<double>(i + j + k) / 6.0;
  const double x0 = x - (static_cast<double>(i) - unskew);
  const double y0 = y - (static_cast<double>(j) - unskew);
  const double z0 = z - (static_cast<double>(k) - unskew);
  int i1 = 0;
  int j1 = 0;
  int k1 = 0;
  int i2 = 0;
  int j2 = 0;
  int k2 = 0;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
    }
  } else if (y0 < z0) {
    i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
  } else if (x0 < z0) {
    i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
  } else {
    i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
  }

  const double x1 = x0 - static_cast<double>(i1) + 1.0 / 6.0;
  const double y1 = y0 - static_cast<double>(j1) + 1.0 / 6.0;
  const double z1 = z0 - static_cast<double>(k1) + 1.0 / 6.0;
  const double x2 = x0 - static_cast<double>(i2) + 1.0 / 3.0;
  const double y2 = y0 - static_cast<double>(j2) + 1.0 / 3.0;
  const double z2 = z0 - static_cast<double>(k2) + 1.0 / 3.0;
  const double x3 = x0 - 0.5;
  const double y3 = y0 - 0.5;
  const double z3 = z0 - 0.5;
  const int ii = i & 255;
  const int jj = j & 255;
  const int kk = k & 255;

  return 32.0 * (
    simplexCorner(perm, ii, jj, kk, 0, 0, 0, x0, y0, z0) +
    simplexCorner(perm, ii, jj, kk, i1, j1, k1, x1, y1, z1) +
    simplexCorner(perm, ii, jj, kk, i2, j2, k2, x2, y2, z2) +
    simplexCorner(perm, ii, jj, kk, 1, 1, 1, x3, y3, z3)
  );
}

uint32_t stormPermutationHash(const uint8_t* perm) {
  uint32_t hash = 2166136261U;
  for (int index = 0; index < 256; ++index) {
    hash ^= static_cast<uint32_t>(perm[index]);
    hash *= 16777619U;
  }
  return hash;
}

int stormPatternQuantized(double value, double scale) {
  return static_cast<int>(std::round(value * scale));
}

uint32_t stormPatternRowCached(
  const uint8_t* perm,
  uint32_t permHash,
  int tileX,
  int tileY,
  int localY,
  int size,
  int frame,
  double fps,
  double threshold,
  double scale,
  double speedX,
  double speedY,
  double speedZ
) {
  if (!perm || size <= 0 || size > 31 || localY < 0 || localY >= size || fps <= 0 || scale <= 0) {
    return 0;
  }

  if (gStormPatternRowCacheFrame != frame) {
    gStormPatternRowCache.clear();
    gStormPatternRowCacheFrame = frame;
  } else if (gStormPatternRowCache.size() > kStormPatternRowCacheMax) {
    gStormPatternRowCache.clear();
  }

  const StormPatternRowKey key {
    permHash,
    tileX,
    tileY,
    localY,
    size,
    stormPatternQuantized(threshold, 10000.0),
    stormPatternQuantized(fps, 1000.0),
    stormPatternQuantized(scale, 10000.0),
    stormPatternQuantized(speedX, 1000.0),
    stormPatternQuantized(speedY, 1000.0),
    stormPatternQuantized(speedZ, 10000.0)
  };
  const auto cached = gStormPatternRowCache.find(key);
  if (cached != gStormPatternRowCache.end()) {
    return cached->second;
  }

  const double timeSeconds = static_cast<double>(frame) / fps;
  const int worldLeft = tileX * size;
  const int worldY = tileY * size + localY;
  uint32_t row = 0;
  for (int px = 0; px < size; ++px) {
    const double sampleX = (static_cast<double>(worldLeft + px) + timeSeconds * speedX) * scale;
    const double sampleY = (static_cast<double>(worldY) + timeSeconds * speedY) * scale;
    const double sampleZ = timeSeconds * speedZ;
    if (simplexNoise3D(perm, sampleX, sampleY, sampleZ) >= threshold) {
      row |= (1U << static_cast<uint32_t>(px));
    }
  }
  gStormPatternRowCache.emplace(key, row);
  return row;
}

int lensProjectionQuantized(double value, double scale) {
  return static_cast<int>(std::round(value * scale));
}

bool lensProjectionConfigMatches(const LensProjectionCacheConfig& config) {
  return gLensProjectionCacheReady &&
    gLensProjectionCacheConfig.screenWidth == config.screenWidth &&
    gLensProjectionCacheConfig.screenHeight == config.screenHeight &&
    gLensProjectionCacheConfig.padding == config.padding &&
    gLensProjectionCacheConfig.edgeScale == config.edgeScale &&
    gLensProjectionCacheConfig.power == config.power &&
    gLensProjectionCacheConfig.noiseRadial == config.noiseRadial &&
    gLensProjectionCacheConfig.noiseTangential == config.noiseTangential &&
    gLensProjectionCacheConfig.defectDensity == config.defectDensity;
}

bool lensProjectionFinalInside(int screenWidth, int screenHeight, double radiusSq, double centerX, double centerY, int x, int y) {
  if (x < 0 || y < 0 || x >= screenWidth || y >= screenHeight) {
    return false;
  }
  const double dx = static_cast<double>(x) + 0.5 - centerX;
  const double dy = static_cast<double>(y) + 0.5 - centerY;
  return dx * dx + dy * dy <= radiusSq;
}

void ensureLensProjectionCache(
  int screenWidth,
  int screenHeight,
  int padding,
  double lensEdgeScale,
  double lensPower,
  double lensNoiseRadial,
  double lensNoiseTangential,
  double lensDefectDensity
) {
  padding = std::max(0, padding);
  const LensProjectionCacheConfig config {
    screenWidth,
    screenHeight,
    padding,
    lensProjectionQuantized(lensEdgeScale, 10000.0),
    lensProjectionQuantized(lensPower, 10000.0),
    lensProjectionQuantized(lensNoiseRadial, 10000.0),
    lensProjectionQuantized(lensNoiseTangential, 10000.0),
    lensProjectionQuantized(lensDefectDensity, 10000.0)
  };
  if (lensProjectionConfigMatches(config)) {
    return;
  }

  const int sourceWidth = screenWidth + padding * 2;
  const int sourceHeight = screenHeight + padding * 2;
  if (screenWidth <= 0 || screenHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    gLensProjectionCache.clear();
    gLensProjectionCacheReady = false;
    return;
  }

  gLensProjectionCache.assign(static_cast<std::size_t>(sourceWidth) * static_cast<std::size_t>(sourceHeight), {});
  gLensProjectionCacheConfig = config;
  gLensProjectionCacheReady = true;

  const double centerX = static_cast<double>(screenWidth) / 2.0;
  const double centerY = static_cast<double>(screenHeight) / 2.0;
  const double radius = std::min(screenWidth, screenHeight) / 2.0;
  const double radiusSq = radius * radius;
  const double edgeScale = std::max(1.0, lensEdgeScale);
  const double maxSourceRadius = radius * edgeScale;
  const double power = std::max(1.0, lensPower);
  const double edgeDenominator = std::max(0.0001, edgeScale - 1.0);

  for (int sy = -padding; sy < screenHeight + padding; ++sy) {
    for (int sx = -padding; sx < screenWidth + padding; ++sx) {
      LensProjectionEntry entry;
      const double dx = static_cast<double>(sx) + 0.5 - centerX;
      const double dy = static_cast<double>(sy) + 0.5 - centerY;
      const double sourceRadius = std::sqrt(dx * dx + dy * dy);
      if (sourceRadius <= maxSourceRadius) {
        if (sourceRadius == 0) {
          entry.baseX = static_cast<int>(std::floor(centerX));
          entry.baseY = static_cast<int>(std::floor(centerY));
        } else {
          const double t = clampDouble(sourceRadius / maxSourceRadius, 0.0, 1.0);
          const double lensScale = 1.0 + (edgeScale - 1.0) * std::pow(t, power);
          const double screenRadius = sourceRadius / lensScale;
          const double unitX = dx / sourceRadius;
          const double unitY = dy / sourceRadius;
          entry.baseX = static_cast<int>(std::floor(centerX + unitX * screenRadius));
          entry.baseY = static_cast<int>(std::floor(centerY + unitY * screenRadius));

          const double lensFalloff = (lensScale - 1.0) / edgeDenominator;
          const double defectDensity = clampDouble(lensFalloff * lensDefectDensity, 0.0, 1.0);
          if (lensNoiseUnitAt(sx, sy, 0x36d2ae31U) <= defectDensity) {
            const double radialNoise = (lensNoiseUnitAt(sx, sy, 0x4f1bbcdcU) * 2.0 - 1.0) * lensNoiseRadial;
            const double tangentNoise = (lensNoiseUnitAt(sx, sy, 0x8ab23d31U) * 2.0 - 1.0) * lensNoiseTangential;
            entry.defectX = static_cast<int>(std::floor(centerX + unitX * (screenRadius + radialNoise) - unitY * tangentNoise));
            entry.defectY = static_cast<int>(std::floor(centerY + unitY * (screenRadius + radialNoise) + unitX * tangentNoise));
            entry.defectPresent = 1;
            entry.defectValid = lensProjectionFinalInside(
              screenWidth,
              screenHeight,
              radiusSq,
              centerX,
              centerY,
              entry.defectX,
              entry.defectY
            ) ? 1 : 0;
          }
        }
        entry.baseValid = lensProjectionFinalInside(
          screenWidth,
          screenHeight,
          radiusSq,
          centerX,
          centerY,
          entry.baseX,
          entry.baseY
        ) ? 1 : 0;
      }

      const int cacheX = sx + padding;
      const int cacheY = sy + padding;
      gLensProjectionCache[static_cast<std::size_t>(cacheY) * static_cast<std::size_t>(sourceWidth) + static_cast<std::size_t>(cacheX)] = entry;
    }
  }
}

const LensProjectionEntry& lensProjectionEntryAt(int sx, int sy, int screenWidth, int padding) {
  const int sourceWidth = screenWidth + padding * 2;
  const int cacheX = sx + padding;
  const int cacheY = sy + padding;
  static const LensProjectionEntry empty;
  if (
    sourceWidth <= 0 ||
    cacheX < 0 ||
    cacheY < 0 ||
    cacheX >= sourceWidth ||
    static_cast<std::size_t>(cacheY) * static_cast<std::size_t>(sourceWidth) + static_cast<std::size_t>(cacheX) >= gLensProjectionCache.size()
  ) {
    return empty;
  }
  return gLensProjectionCache[static_cast<std::size_t>(cacheY) * static_cast<std::size_t>(sourceWidth) + static_cast<std::size_t>(cacheX)];
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
  (void)playable;
  if (!visibilityInBounds(width, height, tileX, tileY)) {
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
  (void)playable;
  if (!visibilityInBounds(width, height, tileX, tileY)) {
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
  (void)playable;
  if (!visibilityInBounds(width, height, tileX, tileY)) {
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

bool raycastInBounds(int width, int height, int tileX, int tileY) {
  return tileX >= 0 && tileY >= 0 && tileX < width && tileY < height;
}

bool raycastRockCollisionTileAt(const uint8_t* tiles, int width, int height, int tileX, int tileY) {
  if (!raycastInBounds(width, height, tileX, tileY)) {
    return false;
  }
  return isRockCollisionTile(tiles[tileY * width + tileX]);
}

Blocker raycastTileBlocker(
  const uint8_t* tiles,
  int width,
  int height,
  double tileSize,
  int tileX,
  int tileY,
  uint8_t tile
) {
  Blocker blocker;
  blocker.x = static_cast<double>(tileX) * tileSize;
  blocker.y = static_cast<double>(tileY) * tileSize;
  blocker.width = tileSize;
  blocker.height = tileSize;
  blocker.radius = 0;
  blocker.cornerMask = 0;

  if (!isRockCollisionTile(tile)) {
    return blocker;
  }

  const bool north = raycastRockCollisionTileAt(tiles, width, height, tileX, tileY - 1);
  const bool east = raycastRockCollisionTileAt(tiles, width, height, tileX + 1, tileY);
  const bool south = raycastRockCollisionTileAt(tiles, width, height, tileX, tileY + 1);
  const bool west = raycastRockCollisionTileAt(tiles, width, height, tileX - 1, tileY);
  int cornerMask = 0;
  if (!north && !west) {
    cornerMask |= 1;
  }
  if (!north && !east) {
    cornerMask |= 2;
  }
  if (!south && !east) {
    cornerMask |= 4;
  }
  if (!south && !west) {
    cornerMask |= 8;
  }
  if (cornerMask) {
    blocker.cornerMask = cornerMask;
    blocker.radius = std::max(1.0, std::round(tileSize * kRockCollisionCornerRadiusScale));
  }
  return blocker;
}

int raycastCollisionAt(
  const uint8_t* tiles,
  const uint8_t* playable,
  int width,
  int height,
  int tileX,
  int tileY,
  int blockNonPlayable,
  int& outTileX,
  int& outTileY,
  int& outIndex,
  int& outTile,
  int& outMineable
) {
  outTileX = tileX;
  outTileY = tileY;
  outIndex = -1;
  outTile = 0;
  outMineable = 0;
  if (!raycastInBounds(width, height, tileX, tileY)) {
    return blockNonPlayable ? 1 : 0;
  }

  const int index = tileY * width + tileX;
  const uint8_t tile = tiles[index];
  outIndex = index;
  outTile = static_cast<int>(tile);
  if (isMineableTile(tile)) {
    outMineable = 1;
    return 1;
  }
  if (blockNonPlayable && playable && playable[index] == 0) {
    return 1;
  }
  return 0;
}

void writeRaycastOut(
  double* out,
  int hit,
  int mineable,
  double x,
  double y,
  double distance,
  int tileX,
  int tileY,
  int index,
  int tile
) {
  out[0] = 1;
  out[1] = hit ? 1 : 0;
  out[2] = mineable ? 1 : 0;
  out[3] = x;
  out[4] = y;
  out[5] = distance;
  out[6] = static_cast<double>(tileX);
  out[7] = static_cast<double>(tileY);
  out[8] = static_cast<double>(index);
  out[9] = static_cast<double>(tile);
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

BS_EXPORT int bs_huck_rock_hull(
  uint32_t seedHash,
  double centerX,
  double centerY,
  double radius,
  double yaw,
  double pitch,
  double roll,
  double* outPoints,
  int maxPointDoubles
) {
  if (!outPoints || maxPointDoubles < 4 || !isFiniteDouble(radius) || radius <= 0) {
    return 0;
  }

  const double pi = std::acos(-1);
  const double yawCos = std::cos(yaw);
  const double yawSin = std::sin(yaw);
  const double pitchCos = std::cos(pitch);
  const double pitchSin = std::sin(pitch);
  const double rollCos = std::cos(roll);
  const double rollSin = std::sin(roll);
  std::vector<HullPoint> projected;
  projected.reserve(kHuckRockPointCount);

  for (int index = 0; index < kHuckRockPointCount; ++index) {
    const double z = randomUnit32(seedHash, index * 2) * 2.0 - 1.0;
    const double angle = randomUnit32(seedHash, index * 2 + 1) * pi * 2.0;
    const double pointRadius = std::sqrt(std::max(0.0, 1.0 - z * z));
    const double px = std::cos(angle) * pointRadius;
    const double py = std::sin(angle) * pointRadius;

    const double yawedX = px * yawCos + z * yawSin;
    const double yawedY = py;
    const double yawedZ = -px * yawSin + z * yawCos;
    const double pitchedX = yawedX;
    const double pitchedY = yawedY * pitchCos - yawedZ * pitchSin;
    const double pitchedZ = yawedY * pitchSin + yawedZ * pitchCos;
    const double rotatedX = pitchedX * rollCos - pitchedY * rollSin;
    const double rotatedY = pitchedX * rollSin + pitchedY * rollCos;
    const double rotatedZ = pitchedZ;
    const double perspective = 2.7 / (2.7 - rotatedZ * 0.55);

    projected.push_back({
      roundedHundredth(centerX + rotatedX * radius * perspective),
      roundedHundredth(centerY + rotatedY * radius * perspective)
    });
  }

  std::sort(projected.begin(), projected.end(), [](const HullPoint& a, const HullPoint& b) {
    if (a.x == b.x) {
      return a.y < b.y;
    }
    return a.x < b.x;
  });

  std::vector<HullPoint> lower;
  lower.reserve(kHuckRockPointCount);
  for (const HullPoint& point : projected) {
    while (lower.size() >= 2 &&
      hullCross(lower[lower.size() - 2], lower[lower.size() - 1], point) <= 0) {
      lower.pop_back();
    }
    lower.push_back(point);
  }

  std::vector<HullPoint> upper;
  upper.reserve(kHuckRockPointCount);
  for (auto it = projected.rbegin(); it != projected.rend(); ++it) {
    while (upper.size() >= 2 &&
      hullCross(upper[upper.size() - 2], upper[upper.size() - 1], *it) <= 0) {
      upper.pop_back();
    }
    upper.push_back(*it);
  }
  if (!lower.empty()) {
    lower.pop_back();
  }
  if (!upper.empty()) {
    upper.pop_back();
  }

  std::vector<HullPoint> hull;
  hull.reserve(lower.size() + upper.size());
  for (const HullPoint& point : lower) {
    hull.push_back(point);
  }
  for (const HullPoint& point : upper) {
    hull.push_back(point);
  }

  const int maxPoints = maxPointDoubles / 2;
  const int count = std::min(static_cast<int>(hull.size()), maxPoints);
  for (int index = 0; index < count; ++index) {
    outPoints[index * 2] = hull[index].x;
    outPoints[index * 2 + 1] = hull[index].y;
  }
  return count;
}

BS_EXPORT int bs_render_visibility_checker_layer(
  const uint8_t* tiles,
  const uint8_t* playable,
  int mapWidth,
  int mapHeight,
  double tileSize,
  double cameraX,
  double cameraY,
  int screenWidth,
  int screenHeight,
  int sourcePadding,
  double lensEdgeScale,
  double lensPower,
  double lensNoiseRadial,
  double lensNoiseTangential,
  double lensDefectDensity,
  uint8_t* outCodes,
  int outCapacity
) {
  if (
    !tiles ||
    !playable ||
    !outCodes ||
    mapWidth <= 0 ||
    mapHeight <= 0 ||
    tileSize <= 0 ||
    screenWidth <= 0 ||
    screenHeight <= 0 ||
    outCapacity < screenWidth * screenHeight
  ) {
    return 0;
  }

  std::fill(outCodes, outCodes + screenWidth * screenHeight, static_cast<uint8_t>(0));

  const int tilePixels = std::max(1, static_cast<int>(std::round(tileSize)));
  const int checkerSize = 2;
  const double centerX = static_cast<double>(screenWidth) / 2.0;
  const double centerY = static_cast<double>(screenHeight) / 2.0;
  const double radius = std::min(screenWidth, screenHeight) / 2.0;
  const double radiusSq = radius * radius;
  const double edgeScale = std::max(1.0, lensEdgeScale);
  const double maxSourceRadius = radius * edgeScale;
  const double power = std::max(1.0, lensPower);
  const double edgeDenominator = std::max(0.0001, edgeScale - 1.0);
  const int minSourceX = -std::max(0, sourcePadding);
  const int minSourceY = -std::max(0, sourcePadding);
  const int maxSourceX = screenWidth + std::max(0, sourcePadding);
  const int maxSourceY = screenHeight + std::max(0, sourcePadding);
  const int mapTileCount = mapWidth * mapHeight;
  const int renderCameraX = static_cast<int>(std::ceil(cameraX - 0.5));
  const int renderCameraY = static_cast<int>(std::ceil(cameraY - 0.5));

  auto writeFinal = [&](int x, int y) {
    if (x < 0 || y < 0 || x >= screenWidth || y >= screenHeight) {
      return;
    }
    const double dx = static_cast<double>(x) + 0.5 - centerX;
    const double dy = static_cast<double>(y) + 0.5 - centerY;
    if (dx * dx + dy * dy > radiusSq) {
      return;
    }
    outCodes[y * screenWidth + x] = 1;
  };

  auto projectAndWrite = [&](int sx, int sy) {
    const double dx = static_cast<double>(sx) + 0.5 - centerX;
    const double dy = static_cast<double>(sy) + 0.5 - centerY;
    const double sourceRadius = std::sqrt(dx * dx + dy * dy);
    if (sourceRadius > maxSourceRadius) {
      return;
    }

    if (sourceRadius == 0) {
      writeFinal(static_cast<int>(std::floor(centerX)), static_cast<int>(std::floor(centerY)));
      return;
    }

    const double t = clampDouble(sourceRadius / maxSourceRadius, 0.0, 1.0);
    const double scale = 1.0 + (edgeScale - 1.0) * std::pow(t, power);
    const double screenRadius = sourceRadius / scale;
    const double unitX = dx / sourceRadius;
    const double unitY = dy / sourceRadius;
    const int baseX = static_cast<int>(std::floor(centerX + unitX * screenRadius));
    const int baseY = static_cast<int>(std::floor(centerY + unitY * screenRadius));
    writeFinal(baseX, baseY);

    const double lensFalloff = (scale - 1.0) / edgeDenominator;
    const double defectDensity = clampDouble(lensFalloff * lensDefectDensity, 0.0, 1.0);
    if (lensNoiseUnitAt(sx, sy, 0x36d2ae31U) > defectDensity) {
      return;
    }

    const double radialNoise = (lensNoiseUnitAt(sx, sy, 0x4f1bbcdcU) * 2.0 - 1.0) * lensNoiseRadial;
    const double tangentNoise = (lensNoiseUnitAt(sx, sy, 0x8ab23d31U) * 2.0 - 1.0) * lensNoiseTangential;
    writeFinal(
      static_cast<int>(std::floor(centerX + unitX * (screenRadius + radialNoise) - unitY * tangentNoise)),
      static_cast<int>(std::floor(centerY + unitY * (screenRadius + radialNoise) + unitX * tangentNoise))
    );
  };

  for (int sy = minSourceY; sy < maxSourceY; ++sy) {
    const int worldPixelY = sy + renderCameraY;
    const int tileY = floorDivInt(worldPixelY, tilePixels);
    const int localY = positiveModuloInt(worldPixelY, tilePixels);
    const int checkerY = localY / checkerSize;

    for (int sx = minSourceX; sx < maxSourceX; ++sx) {
      const int worldPixelX = sx + renderCameraX;
      const int tileX = floorDivInt(worldPixelX, tilePixels);
      const int localX = positiveModuloInt(worldPixelX, tilePixels);
      if ((((localX / checkerSize) + checkerY) & 1) == 0) {
        continue;
      }

      bool skip = false;
      if (tileX >= 0 && tileY >= 0 && tileX < mapWidth && tileY < mapHeight) {
        const int index = tileY * mapWidth + tileX;
        if (index >= 0 && index < mapTileCount && playable[index] && isRenderSolidTile(tiles[index])) {
          skip = true;
        }
      }
      if (!skip) {
        projectAndWrite(sx, sy);
      }
    }
  }

  return 1;
}

BS_EXPORT int bs_render_storm_layer(
  const uint8_t* storm,
  const uint8_t* playable,
  const uint8_t* perm,
  int mapWidth,
  int mapHeight,
  double tileSize,
  double cameraX,
  double cameraY,
  int screenWidth,
  int screenHeight,
  int sourcePadding,
  double lensEdgeScale,
  double lensPower,
  double lensNoiseRadial,
  double lensNoiseTangential,
  double lensDefectDensity,
  const int* maskRows,
  int maskRowCount,
  const int* maskSpans,
  int maskSpanCount,
  int maskOffsetY,
  int frame,
  double fps,
  double threshold,
  double scale,
  double speedX,
  double speedY,
  double speedZ,
  uint8_t* outCodes,
  int outCapacity
) {
  if (
    !storm ||
    !perm ||
    !outCodes ||
    mapWidth <= 0 ||
    mapHeight <= 0 ||
    tileSize <= 0 ||
    screenWidth <= 0 ||
    screenHeight <= 0 ||
    fps <= 0 ||
    scale <= 0 ||
    outCapacity < screenWidth * screenHeight
  ) {
    return 0;
  }

  std::fill(outCodes, outCodes + screenWidth * screenHeight, static_cast<uint8_t>(0));

  const bool sourceMode = lensEdgeScale <= 0;
  const double centerX = static_cast<double>(screenWidth) / 2.0;
  const double centerY = static_cast<double>(screenHeight) / 2.0;
  const double radius = std::min(screenWidth, screenHeight) / 2.0;
  const double radiusSq = radius * radius;
  const int padding = std::max(0, sourcePadding);
  const int minSourceX = -padding;
  const int minSourceY = -padding;
  const int maxSourceX = screenWidth + padding;
  const int maxSourceY = screenHeight + padding;
  const double timeSeconds = static_cast<double>(frame) / fps;
  int written = 0;
  if (!sourceMode) {
    ensureLensProjectionCache(
      screenWidth,
      screenHeight,
      padding,
      lensEdgeScale,
      lensPower,
      lensNoiseRadial,
      lensNoiseTangential,
      lensDefectDensity
    );
  }

  auto maskAllows = [&](int sx, int sy) {
    if (!maskRows || !maskSpans || maskRowCount <= 0 || maskSpanCount <= 0) {
      return true;
    }
    const int row = sy - maskOffsetY;
    if (row < 0 || row >= maskRowCount) {
      return false;
    }
    const int start = maskRows[row * 2];
    const int count = maskRows[row * 2 + 1];
    if (start < 0 || count <= 0 || start + count > maskSpanCount) {
      return false;
    }
    for (int index = start; index + 1 < start + count; index += 2) {
      if (sx >= maskSpans[index] && sx < maskSpans[index + 1]) {
        return true;
      }
    }
    return false;
  };

  auto writeFinal = [&](int x, int y, uint8_t code) {
    if (x < 0 || y < 0 || x >= screenWidth || y >= screenHeight) {
      return false;
    }
    if (!sourceMode) {
      const double dx = static_cast<double>(x) + 0.5 - centerX;
      const double dy = static_cast<double>(y) + 0.5 - centerY;
      if (dx * dx + dy * dy > radiusSq) {
        return false;
      }
    }
    uint8_t& target = outCodes[y * screenWidth + x];
    const bool wasEmpty = target == 0;
    if (code == 2 || target == 0) {
      target = code;
      if (wasEmpty) {
        written += 1;
      }
      return true;
    }
    return false;
  };

  struct StormProjectedPoint {
    bool valid;
    int x;
    int y;
  };

  auto writeProjectedBridge = [&](int fromX, int fromY, int toX, int toY, uint8_t code) {
    int x = fromX;
    int y = fromY;
    const int dx = std::abs(toX - fromX);
    const int dy = -std::abs(toY - fromY);
    const int stepX = fromX < toX ? 1 : -1;
    const int stepY = fromY < toY ? 1 : -1;
    int error = dx + dy;

    while (true) {
      writeFinal(x, y, code);
      if (x == toX && y == toY) {
        break;
      }
      const int doubled = error * 2;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
  };

  auto projectAndWrite = [&](int sx, int sy, uint8_t code) -> StormProjectedPoint {
    if (sourceMode) {
      return {writeFinal(sx, sy, code), sx, sy};
    }

    const LensProjectionEntry& entry = lensProjectionEntryAt(sx, sy, screenWidth, padding);
    if (!entry.baseValid && !entry.defectPresent) {
      return {false, 0, 0};
    }

    bool wrote = false;
    if (entry.baseValid) {
      wrote = writeFinal(entry.baseX, entry.baseY, code) || wrote;
    }

    if (entry.defectPresent) {
      if (entry.defectValid) {
        wrote = writeFinal(entry.defectX, entry.defectY, code) || wrote;
      }
      return {wrote, entry.defectX, entry.defectY};
    }

    return {wrote, entry.baseX, entry.baseY};
  };

  auto safeTile = [&](int tileX, int tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) {
      return false;
    }
    const int index = tileY * mapWidth + tileX;
    return (!playable || playable[index] != 0) && storm[index] < 2;
  };

  auto distanceToSafe = [&](int tileX, int tileY, double worldX, double worldY) {
    double nearest = 99.0;
    for (int offsetY = -2; offsetY <= 2; ++offsetY) {
      for (int offsetX = -2; offsetX <= 2; ++offsetX) {
        const int candidateX = tileX + offsetX;
        const int candidateY = tileY + offsetY;
        if (!safeTile(candidateX, candidateY)) {
          continue;
        }

        const double rectMinX = static_cast<double>(candidateX) * tileSize;
        const double rectMinY = static_cast<double>(candidateY) * tileSize;
        const double rectMaxX = rectMinX + tileSize;
        const double rectMaxY = rectMinY + tileSize;
        const double dx = std::max(std::max(rectMinX - worldX, worldX - rectMaxX), 0.0);
        const double dy = std::max(std::max(rectMinY - worldY, worldY - rectMaxY), 0.0);
        nearest = std::min(nearest, std::sqrt(dx * dx + dy * dy) / tileSize);
      }
    }
    return nearest;
  };

  auto stormCodeAt = [&](int tileX, int tileY, double worldX, double worldY) {
    const double stormValue = simplexNoise3D(
      perm,
      (worldX + timeSeconds * speedX) * scale,
      (worldY + timeSeconds * speedY) * scale,
      timeSeconds * speedZ
    );
    const double fade = clampDouble(distanceToSafe(tileX, tileY, worldX, worldY) * 0.5, 0.0, 1.0);
    const double foregroundThreshold = threshold + (1.02 - threshold) * fade;
    const double voidThreshold = fade;
    const double normalizedStorm = stormValue * 0.5 + 0.5;
    if (normalizedStorm < voidThreshold) {
      return static_cast<uint8_t>(3);
    }
    return static_cast<uint8_t>(stormValue >= foregroundThreshold ? 2 : 1);
  };

  for (int sy = minSourceY; sy < maxSourceY; ++sy) {
    if (maskRows && maskRowCount > 0) {
      const int row = sy - maskOffsetY;
      if (row < 0 || row >= maskRowCount || maskRows[row * 2 + 1] <= 0) {
        continue;
      }
    }

    const double worldY = static_cast<double>(sy) + cameraY;
    const int tileY = static_cast<int>(std::floor(worldY / tileSize));
    StormProjectedPoint previousForeground{false, 0, 0};
    int previousForegroundTileX = std::numeric_limits<int>::min();
    int previousForegroundSourceX = std::numeric_limits<int>::min();
    for (int sx = minSourceX; sx < maxSourceX; ++sx) {
      if (!maskAllows(sx, sy)) {
        previousForeground.valid = false;
        continue;
      }

      const double worldX = static_cast<double>(sx) + cameraX;
      const int tileX = static_cast<int>(std::floor(worldX / tileSize));
      const bool outOfBounds = tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight;
      const int tileIndex = outOfBounds ? -1 : tileY * mapWidth + tileX;
      if (
        !outOfBounds &&
        storm[tileIndex] != 2 &&
        (!playable || playable[tileIndex] != 0)
      ) {
        previousForeground.valid = false;
        continue;
      }

      const uint8_t code = stormCodeAt(tileX, tileY, std::floor(worldX), std::floor(worldY));
      StormProjectedPoint projected = projectAndWrite(sx, sy, code);
      if (code == 2 && projected.valid) {
        if (
          previousForeground.valid &&
          previousForegroundTileX == tileX &&
          previousForegroundSourceX + 1 == sx
        ) {
          writeProjectedBridge(previousForeground.x, previousForeground.y, projected.x, projected.y, code);
        }
        previousForeground = projected;
        previousForegroundTileX = tileX;
        previousForegroundSourceX = sx;
      } else {
        previousForeground.valid = false;
      }
    }
  }

  return written;
}

BS_EXPORT int bs_render_storm_runs(
  const uint8_t* storm,
  const uint8_t* playable,
  const uint8_t* perm,
  int mapWidth,
  int mapHeight,
  double tileSize,
  double cameraX,
  double cameraY,
  int screenWidth,
  int screenHeight,
  int sourcePadding,
  double lensEdgeScale,
  double lensPower,
  double lensNoiseRadial,
  double lensNoiseTangential,
  double lensDefectDensity,
  int frame,
  double fps,
  double threshold,
  double scale,
  double speedX,
  double speedY,
  double speedZ,
  uint8_t* scratchCodes,
  int scratchCapacity,
  int* outRuns,
  int outRunCapacityInts
) {
  if (
    !outRuns ||
    outRunCapacityInts < 4 ||
    screenWidth <= 0 ||
    screenHeight <= 0
  ) {
    return 0;
  }

  const int written = bs_render_storm_layer(
    storm,
    playable,
    perm,
    mapWidth,
    mapHeight,
    tileSize,
    cameraX,
    cameraY,
    screenWidth,
    screenHeight,
    sourcePadding,
    lensEdgeScale,
    lensPower,
    lensNoiseRadial,
    lensNoiseTangential,
    lensDefectDensity,
    nullptr,
    0,
    nullptr,
    0,
    0,
    frame,
    fps,
    threshold,
    scale,
    speedX,
    speedY,
    speedZ,
    scratchCodes,
    scratchCapacity
  );
  if (written <= 0) {
    return 0;
  }

  const int maxRuns = outRunCapacityInts / 4;
  int runCount = 0;
  for (int y = 0; y < screenHeight; ++y) {
    const int row = y * screenWidth;
    int x = 0;
    while (x < screenWidth) {
      const uint8_t code = scratchCodes[row + x];
      if (code == 0) {
        x += 1;
        continue;
      }

      const int startX = x;
      x += 1;
      while (x < screenWidth && scratchCodes[row + x] == code) {
        x += 1;
      }

      if (runCount >= maxRuns) {
        return -runCount;
      }

      const int offset = runCount * 4;
      outRuns[offset] = y;
      outRuns[offset + 1] = startX;
      outRuns[offset + 2] = x;
      outRuns[offset + 3] = static_cast<int>(code);
      runCount += 1;
    }
  }

  return runCount;
}

BS_EXPORT int bs_render_storm_boundary_runs(
  const uint8_t* storm,
  const uint8_t* playable,
  const uint8_t* perm,
  int mapWidth,
  int mapHeight,
  double tileSize,
  double cameraX,
  double cameraY,
  int screenWidth,
  int screenHeight,
  int sourcePadding,
  double lensEdgeScale,
  double lensPower,
  double lensNoiseRadial,
  double lensNoiseTangential,
  double lensDefectDensity,
  int frame,
  double fps,
  double threshold,
  double scale,
  double speedX,
  double speedY,
  double speedZ,
  int* outRuns,
  int outRunCapacityInts
) {
  if (
    !storm ||
    !playable ||
    !perm ||
    !outRuns ||
    mapWidth <= 0 ||
    mapHeight <= 0 ||
    tileSize <= 0 ||
    screenWidth <= 0 ||
    screenHeight <= 0 ||
    fps <= 0 ||
    scale <= 0 ||
    outRunCapacityInts < 4
  ) {
    return 0;
  }

  auto safeTile = [&](int tileX, int tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) {
      return false;
    }
    const int index = tileY * mapWidth + tileX;
    return playable[index] != 0 && storm[index] == 0;
  };

  const int tilePixels = std::max(1, static_cast<int>(std::round(tileSize)));
  const uint32_t permHash = stormPermutationHash(perm);
  const bool sourceMode = lensEdgeScale <= 0;
  auto stormBoundaryMask = [&](int worldX, int worldY) {
    const int tileX = static_cast<int>(std::floor(static_cast<double>(worldX) / tileSize));
    const int tileY = static_cast<int>(std::floor(static_cast<double>(worldY) / tileSize));
    const int localX = positiveModuloInt(worldX, tilePixels);
    const int localY = positiveModuloInt(worldY, tilePixels);
    const uint32_t row = stormPatternRowCached(
      perm,
      permHash,
      tileX,
      tileY,
      localY,
      tilePixels,
      frame,
      fps,
      threshold,
      scale,
      speedX,
      speedY,
      speedZ
    );
    return (row & (1U << static_cast<uint32_t>(localX))) != 0;
  };

  const int maxRuns = outRunCapacityInts / 4;
  int runCount = 0;
  auto pushRun = [&](int y, int startX, int endX) {
    if (y < 0 || y >= screenHeight || startX >= endX) {
      return true;
    }
    startX = std::max(0, startX);
    endX = std::min(screenWidth, endX);
    if (startX >= endX) {
      return true;
    }
    if (runCount >= maxRuns) {
      return false;
    }
    const int offset = runCount * 4;
    outRuns[offset] = y;
    outRuns[offset + 1] = startX;
    outRuns[offset + 2] = endX;
    outRuns[offset + 3] = 2;
    runCount += 1;
    return true;
  };

  const int padding = std::max(0, sourcePadding);
  const int minTileX = std::max(0, static_cast<int>(std::floor((cameraX - padding) / tileSize)) - 1);
  const int maxTileX = std::min(
    mapWidth - 1,
    static_cast<int>(std::ceil((cameraX + static_cast<double>(screenWidth) + padding) / tileSize)) + 1
  );
  const int minTileY = std::max(0, static_cast<int>(std::floor((cameraY - padding) / tileSize)) - 1);
  const int maxTileY = std::min(
    mapHeight - 1,
    static_cast<int>(std::ceil((cameraY + static_cast<double>(screenHeight) + padding) / tileSize)) + 1
  );
  const double centerX = static_cast<double>(screenWidth) / 2.0;
  const double centerY = static_cast<double>(screenHeight) / 2.0;
  const double radius = std::min(screenWidth, screenHeight) / 2.0;
  const double radiusSq = radius * radius;
  const double edgeScale = std::max(1.0, lensEdgeScale);
  const double maxSourceRadius = radius * edgeScale;
  const double power = std::max(1.0, lensPower);
  const double edgeDenominator = std::max(0.0001, edgeScale - 1.0);

  auto emitPixel = [&](int x, int y) {
    if (x < 0 || y < 0 || x >= screenWidth || y >= screenHeight) {
      return true;
    }
    if (!sourceMode) {
      const double dx = static_cast<double>(x) + 0.5 - centerX;
      const double dy = static_cast<double>(y) + 0.5 - centerY;
      if (dx * dx + dy * dy > radiusSq) {
        return true;
      }
    }
    return pushRun(y, x, x + 1);
  };

  auto emitLine = [&](int x0, int y0, int x1, int y1) {
    const int dx = std::abs(x1 - x0);
    const int dy = -std::abs(y1 - y0);
    const int stepX = x0 < x1 ? 1 : -1;
    const int stepY = y0 < y1 ? 1 : -1;
    int error = dx + dy;
    int x = x0;
    int y = y0;
    while (true) {
      if (!emitPixel(x, y)) {
        return false;
      }
      if (x == x1 && y == y1) {
        break;
      }
      const int doubled = error * 2;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
    return true;
  };

  auto projectBasePoint = [&](int sx, int sy, int& outX, int& outY) {
    if (sourceMode) {
      if (sx < 0 || sy < 0 || sx >= screenWidth || sy >= screenHeight) {
        return false;
      }
      outX = sx;
      outY = sy;
      return true;
    }

    const double dx = static_cast<double>(sx) + 0.5 - centerX;
    const double dy = static_cast<double>(sy) + 0.5 - centerY;
    const double sourceRadius = std::sqrt(dx * dx + dy * dy);
    if (sourceRadius > maxSourceRadius) {
      return false;
    }
    if (sourceRadius == 0) {
      outX = static_cast<int>(std::floor(centerX));
      outY = static_cast<int>(std::floor(centerY));
      return true;
    }

    const double t = clampDouble(sourceRadius / maxSourceRadius, 0.0, 1.0);
    const double lensScale = 1.0 + (edgeScale - 1.0) * std::pow(t, power);
    const double screenRadius = sourceRadius / lensScale;
    const double unitX = dx / sourceRadius;
    const double unitY = dy / sourceRadius;
    outX = static_cast<int>(std::floor(centerX + unitX * screenRadius));
    outY = static_cast<int>(std::floor(centerY + unitY * screenRadius));
    return true;
  };

  auto emitDefectPoint = [&](int sx, int sy) {
    if (sourceMode) {
      return true;
    }

    const double dx = static_cast<double>(sx) + 0.5 - centerX;
    const double dy = static_cast<double>(sy) + 0.5 - centerY;
    const double sourceRadius = std::sqrt(dx * dx + dy * dy);
    if (sourceRadius <= 0 || sourceRadius > maxSourceRadius) {
      return true;
    }

    const double t = clampDouble(sourceRadius / maxSourceRadius, 0.0, 1.0);
    const double lensScale = 1.0 + (edgeScale - 1.0) * std::pow(t, power);
    const double lensFalloff = (lensScale - 1.0) / edgeDenominator;
    const double defectDensity = clampDouble(lensFalloff * lensDefectDensity, 0.0, 1.0);
    if (lensNoiseUnitAt(sx, sy, 0x36d2ae31U) > defectDensity) {
      return true;
    }

    const double screenRadius = sourceRadius / lensScale;
    const double unitX = dx / sourceRadius;
    const double unitY = dy / sourceRadius;
    const double radialNoise = (lensNoiseUnitAt(sx, sy, 0x4f1bbcdcU) * 2.0 - 1.0) * lensNoiseRadial;
    const double tangentNoise = (lensNoiseUnitAt(sx, sy, 0x8ab23d31U) * 2.0 - 1.0) * lensNoiseTangential;
    return emitPixel(
      static_cast<int>(std::floor(centerX + unitX * (screenRadius + radialNoise) - unitY * tangentNoise)),
      static_cast<int>(std::floor(centerY + unitY * (screenRadius + radialNoise) + unitX * tangentNoise))
    );
  };

  auto drawVertical = [&](int screenX, int screenY, int worldX, int worldY) {
    int previousX = 0;
    int previousY = 0;
    bool hasPrevious = false;
    for (int offset = 0; offset < tilePixels; ++offset) {
      const int px = screenX;
      const int py = screenY + offset;
      const bool on = px >= -padding &&
        px < screenWidth + padding &&
        py >= -padding &&
        py < screenHeight + padding &&
        stormBoundaryMask(worldX, worldY + offset);
      if (on) {
        int projectedX = 0;
        int projectedY = 0;
        if (projectBasePoint(px, py, projectedX, projectedY)) {
          if (hasPrevious) {
            if (!emitLine(previousX, previousY, projectedX, projectedY)) {
              return false;
            }
          } else if (!emitPixel(projectedX, projectedY)) {
            return false;
          }
          if (!emitDefectPoint(px, py)) {
            return false;
          }
          previousX = projectedX;
          previousY = projectedY;
          hasPrevious = true;
        } else {
          hasPrevious = false;
        }
      } else {
        hasPrevious = false;
      }
    }
    return true;
  };

  auto drawHorizontal = [&](int screenX, int screenY, int worldX, int worldY) {
    int previousX = 0;
    int previousY = 0;
    bool hasPrevious = false;
    for (int offset = 0; offset < tilePixels; ++offset) {
      const int px = screenX + offset;
      const int py = screenY;
      const bool on = px >= -padding &&
        px < screenWidth + padding &&
        py >= -padding &&
        py < screenHeight + padding &&
        stormBoundaryMask(worldX + offset, worldY);
      if (on) {
        int projectedX = 0;
        int projectedY = 0;
        if (projectBasePoint(px, py, projectedX, projectedY)) {
          if (hasPrevious) {
            if (!emitLine(previousX, previousY, projectedX, projectedY)) {
              return false;
            }
          } else if (!emitPixel(projectedX, projectedY)) {
            return false;
          }
          if (!emitDefectPoint(px, py)) {
            return false;
          }
          previousX = projectedX;
          previousY = projectedY;
          hasPrevious = true;
        } else {
          hasPrevious = false;
        }
      } else {
        hasPrevious = false;
      }
    }
    return true;
  };

  for (int tileY = minTileY; tileY <= maxTileY; ++tileY) {
    for (int tileX = minTileX; tileX <= maxTileX; ++tileX) {
      if (!safeTile(tileX, tileY)) {
        continue;
      }
      const int screenX = static_cast<int>(std::round(static_cast<double>(tileX) * tileSize - cameraX));
      const int screenY = static_cast<int>(std::round(static_cast<double>(tileY) * tileSize - cameraY));
      const int worldX = static_cast<int>(std::round(static_cast<double>(tileX) * tileSize));
      const int worldY = static_cast<int>(std::round(static_cast<double>(tileY) * tileSize));

      if (!safeTile(tileX - 1, tileY) && !drawVertical(screenX, screenY, worldX, worldY)) {
        return -runCount;
      }
      if (!safeTile(tileX + 1, tileY) && !drawVertical(screenX + tilePixels - 1, screenY, worldX + tilePixels - 1, worldY)) {
        return -runCount;
      }
      if (!safeTile(tileX, tileY - 1) && !drawHorizontal(screenX, screenY, worldX, worldY)) {
        return -runCount;
      }
      if (!safeTile(tileX, tileY + 1) && !drawHorizontal(screenX, screenY + tilePixels - 1, worldX, worldY + tilePixels - 1)) {
        return -runCount;
      }
    }
  }

  return runCount;
}

BS_EXPORT int bs_storm_pattern_rows(
  const uint8_t* perm,
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
  if (!perm || !outRows || size <= 0 || size > 32 || fps <= 0 || scale <= 0) {
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
      if (simplexNoise3D(perm, sampleX, sampleY, sampleZ) >= threshold) {
        row |= (1U << static_cast<uint32_t>(px));
      }
    }
    outRows[py] = row;
  }

  return 1;
}
