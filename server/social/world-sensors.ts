import { ENV } from "../_core/env";
import {
  addBeijingCalendarDays,
  beijingMiddayUtcFromYmd,
  diffBeijingCalendarDays,
  formatBeijingDateKeyFromYmd,
  getBeijingTimeParts,
  getGregorianMonthDays,
  isValidGregorianDate,
  parseBeijingCalendarDate,
  type BeijingCalendarDate,
} from "../_core/time-context";

/**
 * 外部世界传感器模块：
 * 1. 双城实时天气与温差传感器（零密钥 Open-Meteo + 内置城市速查 + 动态地理编码 + 30 分钟缓存 + 安全无幻觉降级）
 * 2. 中国节假日、二十四节气、农历节日与角色纪念日传感器（纯本地零网络零延迟）
 */

export type CityCoordinate = {
  name: string;
  latitude: number;
  longitude: number;
};

/**
 * 内置常用中国一二三线城市、港澳台及常见海外城市经纬度速查表（75 座城市）。
 * 命中后直接请求实时预报，省去一次地理编码网络往返。
 */
export const BUILTIN_CITY_COORDINATES: Readonly<
  Record<string, { latitude: number; longitude: number }>
> = {
  // 直辖市与一线/新一线城市
  北京: { latitude: 39.9042, longitude: 116.4074 },
  上海: { latitude: 31.2304, longitude: 121.4737 },
  广州: { latitude: 23.1291, longitude: 113.2644 },
  深圳: { latitude: 22.5431, longitude: 114.0579 },
  南京: { latitude: 32.0603, longitude: 118.7969 },
  武汉: { latitude: 30.5928, longitude: 114.3055 },
  杭州: { latitude: 30.2741, longitude: 120.1551 },
  成都: { latitude: 30.5728, longitude: 104.0668 },
  重庆: { latitude: 29.563, longitude: 106.5516 },
  西安: { latitude: 34.3416, longitude: 108.9398 },
  苏州: { latitude: 31.2989, longitude: 120.5853 },
  天津: { latitude: 39.0842, longitude: 117.201 },
  长沙: { latitude: 28.2282, longitude: 112.9388 },
  郑州: { latitude: 34.7466, longitude: 113.6253 },
  青岛: { latitude: 36.0671, longitude: 120.3826 },
  厦门: { latitude: 24.4798, longitude: 118.0894 },
  东莞: { latitude: 23.0207, longitude: 113.7518 },
  佛山: { latitude: 23.0215, longitude: 113.1214 },
  宁波: { latitude: 29.8683, longitude: 121.544 },
  合肥: { latitude: 31.8206, longitude: 117.2272 },
  无锡: { latitude: 31.4912, longitude: 120.3119 },
  沈阳: { latitude: 41.8057, longitude: 123.4315 },
  哈尔滨: { latitude: 45.8038, longitude: 126.5349 },
  昆明: { latitude: 24.8801, longitude: 102.8329 },
  // 省会与常见二三线城市
  长春: { latitude: 43.8171, longitude: 125.3235 },
  大连: { latitude: 38.914, longitude: 121.6147 },
  济南: { latitude: 36.6512, longitude: 117.1201 },
  烟台: { latitude: 37.4638, longitude: 121.4479 },
  威海: { latitude: 37.5131, longitude: 122.1204 },
  石家庄: { latitude: 38.0428, longitude: 114.5149 },
  保定: { latitude: 38.874, longitude: 115.4646 },
  太原: { latitude: 37.8706, longitude: 112.5489 },
  呼和浩特: { latitude: 40.8426, longitude: 111.7492 },
  南昌: { latitude: 28.682, longitude: 115.8579 },
  福州: { latitude: 26.0745, longitude: 119.2965 },
  泉州: { latitude: 24.8741, longitude: 118.6757 },
  温州: { latitude: 27.9943, longitude: 120.6994 },
  金华: { latitude: 29.0791, longitude: 119.6474 },
  嘉兴: { latitude: 30.7461, longitude: 120.7555 },
  绍兴: { latitude: 30.0303, longitude: 120.5802 },
  常州: { latitude: 31.8112, longitude: 119.9741 },
  南通: { latitude: 31.9802, longitude: 120.8943 },
  徐州: { latitude: 34.2044, longitude: 117.2858 },
  扬州: { latitude: 32.3942, longitude: 119.4129 },
  芜湖: { latitude: 31.3529, longitude: 118.4331 },
  洛阳: { latitude: 34.6197, longitude: 112.454 },
  珠海: { latitude: 22.271, longitude: 113.5767 },
  惠州: { latitude: 23.1115, longitude: 114.4162 },
  中山: { latitude: 22.5176, longitude: 113.3928 },
  南宁: { latitude: 22.817, longitude: 108.3665 },
  桂林: { latitude: 25.2736, longitude: 110.29 },
  海口: { latitude: 20.044, longitude: 110.1999 },
  三亚: { latitude: 18.2528, longitude: 109.512 },
  贵阳: { latitude: 26.647, longitude: 106.6302 },
  大理: { latitude: 25.6065, longitude: 100.2676 },
  丽江: { latitude: 26.8721, longitude: 100.2299 },
  拉萨: { latitude: 29.6525, longitude: 91.1721 },
  兰州: { latitude: 36.0611, longitude: 103.8343 },
  西宁: { latitude: 36.6171, longitude: 101.7782 },
  银川: { latitude: 38.4872, longitude: 106.2309 },
  乌鲁木齐: { latitude: 43.8256, longitude: 87.6168 },
  // 港澳台
  香港: { latitude: 22.3193, longitude: 114.1694 },
  澳门: { latitude: 22.1987, longitude: 113.5439 },
  台北: { latitude: 25.033, longitude: 121.5654 },
  高雄: { latitude: 22.6273, longitude: 120.3014 },
  // 常见海外城市
  东京: { latitude: 35.6762, longitude: 139.6503 },
  大阪: { latitude: 34.6937, longitude: 135.5023 },
  京都: { latitude: 35.0116, longitude: 135.7681 },
  首尔: { latitude: 37.5665, longitude: 126.978 },
  新加坡: { latitude: 1.3521, longitude: 103.8198 },
  曼谷: { latitude: 13.7563, longitude: 100.5018 },
  吉隆坡: { latitude: 3.139, longitude: 101.6869 },
  悉尼: { latitude: -33.8688, longitude: 151.2093 },
  墨尔本: { latitude: -37.8136, longitude: 144.9631 },
  伦敦: { latitude: 51.5074, longitude: -0.1278 },
  巴黎: { latitude: 48.8566, longitude: 2.3522 },
  柏林: { latitude: 52.52, longitude: 13.405 },
  慕尼黑: { latitude: 48.1351, longitude: 11.582 },
  苏黎世: { latitude: 47.3769, longitude: 8.5417 },
  罗马: { latitude: 41.9028, longitude: 12.4964 },
  马德里: { latitude: 40.4168, longitude: -3.7038 },
  莫斯科: { latitude: 55.7558, longitude: 37.6173 },
  纽约: { latitude: 40.7128, longitude: -74.006 },
  洛杉矶: { latitude: 34.0522, longitude: -118.2437 },
  旧金山: { latitude: 37.7749, longitude: -122.4194 },
  西雅图: { latitude: 47.6062, longitude: -122.3321 },
  芝加哥: { latitude: 41.8781, longitude: -87.6298 },
  波士顿: { latitude: 42.3601, longitude: -71.0589 },
  温哥华: { latitude: 49.2827, longitude: -123.1207 },
  多伦多: { latitude: 43.6532, longitude: -79.3832 },
};

const BUILTIN_CITY_NAMES_SORTED = Object.keys(BUILTIN_CITY_COORDINATES).sort(
  (a, b) => b.length - a.length,
);

/** 30 分钟实时天气进程内内存缓存有效期（毫秒）。 */
export const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
/** 24 小时动态地理编码内存缓存有效期（毫秒）。 */
const GEOCODING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

export const WEATHER_UNAVAILABLE_FALLBACK_SUMMARY =
  "实时天气暂时无法获取（请勿编造具体度数，仅按季节与日常常识自然聊天）";

export type CityWeatherSnapshot = {
  city: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  apparentTemperatureC: number;
  weatherCode: number;
  weatherDesc: string;
  windSpeedKmh?: number;
  humidityPercent?: number;
  todayMaxC?: number;
  todayMinC?: number;
  todayPrecipProbPercent?: number;
  tomorrowMaxC?: number;
  tomorrowMinC?: number;
  tomorrowPrecipProbPercent?: number;
  fetchedAt: number;
  fromCache: boolean;
};

export type DualCityWeatherOptions = {
  personaCity?: string | null;
  userCity?: string | null;
  requestedCities?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: Date;
  fetchImpl?: typeof fetch;
};

export type DualCityWeatherResult = {
  ok: boolean;
  summary: string;
  cities: CityWeatherSnapshot[];
  temperatureDiffC: number | null;
  fromCache: boolean;
};

type WeatherCacheEntry = {
  snapshot: CityWeatherSnapshot;
  expiresAt: number;
};

type GeocodingCacheEntry = {
  coord: CityCoordinate;
  expiresAt: number;
};

const weatherCache = new Map<string, WeatherCacheEntry>();
const geocodingCache = new Map<string, GeocodingCacheEntry>();

/** 清空外部世界传感器进程内缓存（仅供单元测试使用）。 */
export function resetWorldSensorCacheForTests(): void {
  weatherCache.clear();
  geocodingCache.clear();
}

function pruneMapIfNeeded<K, V extends { expiresAt: number }>(
  map: Map<K, V>,
  nowMs: number,
): void {
  if (map.size < MAX_CACHE_ENTRIES) return;
  for (const [key, entry] of Array.from(map.entries())) {
    if (entry.expiresAt <= nowMs) {
      map.delete(key);
    }
  }
  while (map.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

const ADMIN_SUFFIX_PATTERN =
  /(?:特别行政区|维吾尔自治区|回族自治区|壮族自治区|自治区|自治州|自治县|地区|省|市|区|县)$/;
const CITY_NAME_PATTERN = new RegExp("^\\p{L}[\\p{L}\\p{M} .’'-]{0,59}$", "u");

/**
 * 规范化城市名称：去掉首尾空白与“省/市/区/自治区/特别行政区”等行政后缀，支持省市连写匹配内置表。
 */
export function normalizeCityName(raw: string | null | undefined): string {
  if (!raw) return "";
  let cleaned = raw
    .trim()
    .replace(/^中国/, "")
    .replace(/\s+/g, " ");
  if (!CITY_NAME_PATTERN.test(cleaned)) return "";

  if (BUILTIN_CITY_COORDINATES[cleaned]) {
    return cleaned;
  }

  // 剥离行政后缀（保证剥离后至少保留 2 个字符，避免“沙区”变单字）
  const stripped = cleaned.replace(ADMIN_SUFFIX_PATTERN, "");
  if (stripped.length >= 2) {
    if (BUILTIN_CITY_COORDINATES[stripped]) {
      return stripped;
    }
    cleaned = stripped;
  }

  // 支持省市或校区连写（如“江苏省南京市”“湖北武汉洪山”）匹配内置常见城市
  if (cleaned.length <= 14) {
    for (const builtin of BUILTIN_CITY_NAMES_SORTED) {
      if (cleaned.includes(builtin)) {
        return builtin;
      }
    }
  }

  return cleaned;
}

/**
 * 将 Open-Meteo 返回的 WMO 天气代码映射为自然的中文天气描述。
 */
export function describeWmoWeatherCode(code: number): string {
  switch (Math.trunc(code)) {
    case 0:
      return "晴朗";
    case 1:
      return "晴间多云";
    case 2:
      return "多云";
    case 3:
      return "阴天";
    case 45:
    case 48:
      return "起雾";
    case 51:
      return "毛毛雨";
    case 53:
    case 55:
      return "细雨";
    case 56:
    case 57:
      return "冻毛毛雨";
    case 61:
      return "小雨";
    case 63:
      return "中雨";
    case 65:
      return "大雨";
    case 66:
    case 67:
      return "冻雨";
    case 71:
      return "小雪";
    case 73:
      return "中雪";
    case 75:
      return "大雪";
    case 77:
      return "雪粒";
    case 80:
      return "小阵雨";
    case 81:
      return "阵雨";
    case 82:
      return "强阵雨";
    case 85:
      return "小阵雪";
    case 86:
      return "大阵雪";
    case 95:
      return "雷阵雨";
    case 96:
    case 99:
      return "雷阵雨伴冰雹";
    default:
      return "多云";
  }
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const effectiveTimeout = Math.max(200, timeoutMs);
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`外部天气请求超时（${effectiveTimeout}ms）`));
    }, effectiveTimeout);
  });

  try {
    requestSignal.throwIfAborted();
    const response = await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: requestSignal,
      }),
      timeoutPromise,
    ]);

    if (!response || !response.ok) {
      throw new Error(`HTTP 状态异常：${response?.status ?? "未知"}`);
    }

    return await Promise.race([response.json(), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function resolveCityCoordinate(
  rawCity: string,
  options: {
    timeoutMs: number;
    nowMs: number;
    fetchImpl: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<CityCoordinate | null> {
  const normalized = normalizeCityName(rawCity);
  if (!normalized) return null;

  const builtin = BUILTIN_CITY_COORDINATES[normalized];
  if (builtin) {
    return {
      name: normalized,
      latitude: builtin.latitude,
      longitude: builtin.longitude,
    };
  }

  const cacheKey = normalized.toLowerCase();
  const cached = geocodingCache.get(cacheKey);
  if (cached && cached.expiresAt > options.nowMs) {
    return cached.coord;
  }

  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    normalized,
  )}&count=1&language=zh`;

  const payload = await fetchJsonWithTimeout(
    geocodeUrl,
    options.timeoutMs,
    options.fetchImpl,
    options.signal,
  );
  if (!isRecord(payload) || !Array.isArray(payload.results) || payload.results.length === 0) {
    return null;
  }
  const first = payload.results[0];
  if (!isRecord(first)) return null;

  const latitude = finiteNumber(first.latitude);
  const longitude = finiteNumber(first.longitude);
  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  const resolvedName =
    typeof first.name === "string" && first.name.trim()
      ? normalizeCityName(first.name) || normalized
      : normalized;

  const coord: CityCoordinate = {
    name: resolvedName,
    latitude,
    longitude,
  };

  pruneMapIfNeeded(geocodingCache, options.nowMs);
  geocodingCache.set(cacheKey, {
    coord,
    expiresAt: options.nowMs + GEOCODING_CACHE_TTL_MS,
  });

  return coord;
}

async function fetchSingleCityWeather(
  rawCity: string,
  options: {
    timeoutMs: number;
    nowMs: number;
    fetchImpl: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<CityWeatherSnapshot | null> {
  const normalized = normalizeCityName(rawCity);
  if (!normalized) return null;

  const cacheKey = normalized.toLowerCase();
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > options.nowMs) {
    return {
      ...cached.snapshot,
      fromCache: true,
    };
  }

  const coord = await resolveCityCoordinate(normalized, options);
  if (!coord) return null;

  // 若动态地理编码规范化出了另一个标准名，也检查一次缓存
  const resolvedKey = coord.name.toLowerCase();
  const resolvedCached = weatherCache.get(resolvedKey);
  if (resolvedCached && resolvedCached.expiresAt > options.nowMs) {
    return {
      ...resolvedCached.snapshot,
      fromCache: true,
    };
  }

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${coord.latitude}&longitude=${coord.longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Asia%2FShanghai&forecast_days=2`;

  const payload = await fetchJsonWithTimeout(
    forecastUrl,
    options.timeoutMs,
    options.fetchImpl,
    options.signal,
  );
  if (!isRecord(payload) || !isRecord(payload.current)) {
    return null;
  }

  const current = payload.current;
  const temperatureC = finiteNumber(current.temperature_2m);
  if (temperatureC === undefined) return null;

  const apparentTemperatureC =
    finiteNumber(current.apparent_temperature) ?? temperatureC;
  const weatherCode = finiteNumber(current.weather_code) ?? 2;
  const windSpeedKmh = finiteNumber(current.wind_speed_10m);
  const humidityPercent = finiteNumber(current.relative_humidity_2m);

  const daily = isRecord(payload.daily) ? payload.daily : {};
  const maxArr = Array.isArray(daily.temperature_2m_max)
    ? daily.temperature_2m_max
    : [];
  const minArr = Array.isArray(daily.temperature_2m_min)
    ? daily.temperature_2m_min
    : [];
  const precipArr = Array.isArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max
    : [];

  const snapshot: CityWeatherSnapshot = {
    city: coord.name,
    latitude: coord.latitude,
    longitude: coord.longitude,
    temperatureC,
    apparentTemperatureC,
    weatherCode,
    weatherDesc: describeWmoWeatherCode(weatherCode),
    windSpeedKmh,
    humidityPercent,
    todayMaxC: finiteNumber(maxArr[0]),
    todayMinC: finiteNumber(minArr[0]),
    todayPrecipProbPercent: finiteNumber(precipArr[0]),
    tomorrowMaxC: finiteNumber(maxArr[1]),
    tomorrowMinC: finiteNumber(minArr[1]),
    tomorrowPrecipProbPercent: finiteNumber(precipArr[1]),
    fetchedAt: options.nowMs,
    fromCache: false,
  };

  pruneMapIfNeeded(weatherCache, options.nowMs);
  const entry: WeatherCacheEntry = {
    snapshot,
    expiresAt: options.nowMs + WEATHER_CACHE_TTL_MS,
  };
  weatherCache.set(cacheKey, entry);
  if (resolvedKey !== cacheKey) {
    weatherCache.set(resolvedKey, entry);
  }

  return snapshot;
}

function formatSingleCityWeatherClause(item: CityWeatherSnapshot): string {
  const temp = Math.round(item.temperatureC);
  const apparent = Math.round(item.apparentTemperatureC);
  const details: string[] = [`体感 ${apparent}°C`];

  if (item.todayMinC !== undefined && item.todayMaxC !== undefined) {
    details.push(`今日 ${Math.round(item.todayMinC)}~${Math.round(item.todayMaxC)}°C`);
  }
  if (
    item.todayPrecipProbPercent !== undefined &&
    item.todayPrecipProbPercent >= 40
  ) {
    details.push(`降水概率 ${Math.round(item.todayPrecipProbPercent)}%`);
  }

  return `${item.city}当前 ${temp}°C ${item.weatherDesc}（${details.join("，")}）`;
}

/**
 * 获取单城或双城实时天气及温差对比摘要。
 * 网络异常、超时、无可用城市或上游错误时静默降级返回无幻觉提示，绝不抛出未捕获异常。
 */
export async function getDualCityWeatherSummary(
  options: DualCityWeatherOptions = {},
): Promise<DualCityWeatherResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      summary: WEATHER_UNAVAILABLE_FALLBACK_SUMMARY,
      cities: [],
      temperatureDiffC: null,
      fromCache: false,
    };
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const timeoutMs =
    options.timeoutMs ?? ENV.companionWeatherTimeoutMs ?? 5_000;

  const rawList =
    options.requestedCities && options.requestedCities.some((c) => c?.trim())
      ? options.requestedCities
      : [options.personaCity ?? "", options.userCity ?? ""];

  const uniqueCities: string[] = [];
  const seenKeys = new Set<string>();
  for (const item of rawList) {
    const normalized = normalizeCityName(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueCities.push(normalized);
    if (uniqueCities.length >= 3) break;
  }

  if (uniqueCities.length === 0) {
    return {
      ok: false,
      summary: WEATHER_UNAVAILABLE_FALLBACK_SUMMARY,
      cities: [],
      temperatureDiffC: null,
      fromCache: false,
    };
  }

  try {
    const settled = await Promise.all(
      uniqueCities.map((city) =>
        fetchSingleCityWeather(city, { timeoutMs, nowMs, fetchImpl, signal: options.signal }).catch(
          () => null,
        ),
      ),
    );
    const validSnapshots = settled.filter(
      (item): item is CityWeatherSnapshot => item !== null,
    );

    if (validSnapshots.length === 0) {
      return {
        ok: false,
        summary: WEATHER_UNAVAILABLE_FALLBACK_SUMMARY,
        cities: [],
        temperatureDiffC: null,
        fromCache: false,
      };
    }

    const clauses = validSnapshots.map(formatSingleCityWeatherClause);
    let summary = clauses.join("；");
    let temperatureDiffC: number | null = null;

    if (validSnapshots.length >= 2) {
      const first = validSnapshots[0];
      const second = validSnapshots[1];
      const rawDiff = first.temperatureC - second.temperatureC;
      temperatureDiffC = Math.round(rawDiff * 10) / 10;
      const roundedAbs = Math.round(Math.abs(rawDiff));

      if (roundedAbs === 0) {
        summary += `，${first.city}与${second.city}当前气温相近`;
      } else if (rawDiff < 0) {
        summary += `，${first.city}比${second.city}低约 ${roundedAbs}°C`;
      } else {
        summary += `，${first.city}比${second.city}高约 ${roundedAbs}°C`;
      }
    }

    return {
      ok: true,
      summary,
      cities: validSnapshots,
      temperatureDiffC,
      fromCache: validSnapshots.every((item) => item.fromCache),
    };
  } catch {
    return {
      ok: false,
      summary: WEATHER_UNAVAILABLE_FALLBACK_SUMMARY,
      cities: [],
      temperatureDiffC: null,
      fromCache: false,
    };
  }
}

const NEGATED_CITY_LEFT_CONTEXT =
  /(?:不在|没在|未在|并非在|不是在|不再在|离开|搬离|搬出|撤离|告别|不去|没去|未去|回不去|逃离)[\u4e00-\u9fa5]{0,2}$/;
const NEGATED_CITY_RIGHT_CONTEXT = /^(?:离开|搬走|迁出)/;
const PAST_CITY_LEFT_CONTEXT =
  /(?:以前|之前|曾经|早年|过去|曾|原本|原来)[\u4e00-\u9fa5]{0,3}$/;
const CURRENT_RESIDENCE_LEFT_CONTEXT =
  /(?:常驻|定居|住在|居住在|留在|目前在|现在在|如今在|搬到|来到|回到|位于|就读于|工作在)[\u4e00-\u9fa5]{0,2}$/;
const FALSE_POSITIVE_CITY_PHRASE = /(?:不|太|最|很|更|巨)大理(?:解|由|论)|中山装/g;

type ScoredCityMention = {
  city: string;
  score: number;
  index: number;
};

function scanPositiveCitiesInClause(clause: string): ScoredCityMention[] {
  const sanitized = clause.replace(FALSE_POSITIVE_CITY_PHRASE, "  ");
  const mentions: ScoredCityMention[] = [];

  for (const city of BUILTIN_CITY_NAMES_SORTED) {
    let fromIdx = 0;
    while (fromIdx < sanitized.length) {
      const idx = sanitized.indexOf(city, fromIdx);
      if (idx === -1) break;
      fromIdx = idx + city.length;

      // 避免长城市已覆盖短子串重复计入
      if (
        mentions.some(
          (m) => idx >= m.index && idx < m.index + m.city.length,
        )
      ) {
        continue;
      }

      const left = sanitized.slice(Math.max(0, idx - 10), idx);
      const right = sanitized.slice(
        idx + city.length,
        Math.min(sanitized.length, idx + city.length + 6),
      );

      if (
        NEGATED_CITY_LEFT_CONTEXT.test(left) ||
        NEGATED_CITY_RIGHT_CONTEXT.test(right)
      ) {
        continue;
      }

      let score = 10;
      if (CURRENT_RESIDENCE_LEFT_CONTEXT.test(left)) {
        score += 20;
      } else if (PAST_CITY_LEFT_CONTEXT.test(left)) {
        score -= 8;
      }

      mentions.push({ city, score, index: idx });
    }
  }

  return mentions.sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * 从单段自然语言文本中提取有效（非否定提及）的常见城市列表。
 */
export function extractCityMentionsFromText(text: string): string[] {
  if (!text?.trim()) return [];
  const clauses = text.split(/[，。！？!?；;\n]+/);
  const aggregated = new Map<string, number>();

  for (const clause of clauses) {
    for (const item of scanPositiveCitiesInClause(clause)) {
      const prev = aggregated.get(item.city);
      if (prev === undefined || item.score > prev) {
        aggregated.set(item.city, item.score);
      }
    }
  }

  return Array.from(aggregated.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([city]) => city);
}

/** 判断文本中是否正向提及了内置常见城市（已排除否定提及与常见歧义词）。 */
export function containsKnownCityName(text: string): boolean {
  return extractCityMentionsFromText(text).length > 0;
}

/** 只读用户或角色资料明确指定的城市，不通过过往聊天推断所在地。 */
export function readCompanionCities(personaData: unknown): { personaCity: string; userCity: string } {
  const sections = isRecord(personaData) ? personaData.profileSections : undefined;
  const life = isRecord(sections) && isRecord(sections.life) ? sections.life : {};
  const personaCity = typeof life.personaCity === "string" ? life.personaCity : life.city;
  return {
    personaCity: normalizeCityName(typeof personaCity === "string" ? personaCity : null),
    userCity: normalizeCityName(typeof life.userCity === "string" ? life.userCity : null),
  };
}

const CHINESE_NUMERIC_FORMATTER = new Intl.DateTimeFormat("zh-u-ca-chinese", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
});

const CHINESE_LONG_FORMATTER = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const LUNAR_MONTH_LABELS = [
  "",
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "腊月",
];

const LUNAR_DAY_LABELS = [
  "",
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];

const CHINESE_MONTH_NAME_TO_NUM: Record<string, number> = {
  正月: 1,
  一月: 1,
  二月: 2,
  三月: 3,
  四月: 4,
  五月: 5,
  六月: 6,
  七月: 7,
  八月: 8,
  九月: 9,
  十月: 10,
  冬月: 11,
  十一月: 11,
  腊月: 12,
  十二月: 12,
};

export type ChineseLunarDate = {
  lunarYear: number | null;
  ganzhiYear: string;
  month: number;
  day: number;
  isLeapMonth: boolean;
  monthLabel: string;
  dayLabel: string;
  fullLabel: string;
};

function parseLunarMonthNumber(rawNumeric: string, rawLong: string): {
  month: number;
  isLeapMonth: boolean;
} {
  const isLeapMonth =
    /闰|bis|leap/i.test(rawNumeric) || /闰|bis|leap/i.test(rawLong);
  const digits = rawNumeric.replace(/\D+/g, "");
  if (digits) {
    const parsed = Number.parseInt(digits, 10);
    if (parsed >= 1 && parsed <= 12) {
      return { month: parsed, isLeapMonth };
    }
  }
  const cleanLong = rawLong.replace(/^闰/, "").trim();
  const mapped = CHINESE_MONTH_NAME_TO_NUM[cleanLong];
  return {
    month: mapped ?? 1,
    isLeapMonth,
  };
}

function parseLunarDayNumber(rawDay: string): number {
  const digits = rawDay.replace(/\D+/g, "");
  if (digits) {
    const parsed = Number.parseInt(digits, 10);
    if (parsed >= 1 && parsed <= 30) return parsed;
  }
  const idx = LUNAR_DAY_LABELS.indexOf(rawDay.trim());
  return idx > 0 ? idx : 1;
}

/**
 * 使用 Node.js 内置 Intl.DateTimeFormat("zh-u-ca-chinese") 零依赖解析精确农历年月日及闰月标识。
 */
export function getChineseLunarDate(
  input: Date | string = new Date(),
): ChineseLunarDate {
  const cal =
    parseBeijingCalendarDate(input) ??
    parseBeijingCalendarDate(new Date())!;
  const midday = beijingMiddayUtcFromYmd(cal.year, cal.month, cal.day);

  const numParts = CHINESE_NUMERIC_FORMATTER.formatToParts(midday);
  const longParts = CHINESE_LONG_FORMATTER.formatToParts(midday);

  const rawNumMonth = numParts.find((p) => p.type === "month")?.value ?? "";
  const rawNumDay = numParts.find((p) => p.type === "day")?.value ?? "";
  const rawLongMonth = longParts.find((p) => p.type === "month")?.value ?? "";
  const ganzhiYear =
    longParts.find((p) => (p.type as string) === "yearName")?.value ?? "";
  const relatedYearRaw =
    longParts.find((p) => (p.type as string) === "relatedYear")?.value ?? "";
  const lunarYear = relatedYearRaw
    ? Number.parseInt(relatedYearRaw, 10)
    : null;

  const { month, isLeapMonth } = parseLunarMonthNumber(
    rawNumMonth,
    rawLongMonth,
  );
  const day = parseLunarDayNumber(rawNumDay);

  const baseMonthLabel = LUNAR_MONTH_LABELS[month] || `${month}月`;
  const monthLabel = isLeapMonth ? `闰${baseMonthLabel}` : baseMonthLabel;
  const dayLabel = LUNAR_DAY_LABELS[day] || `${day}日`;
  const yearPrefix = ganzhiYear ? `${ganzhiYear}年` : "";

  return {
    lunarYear: Number.isFinite(lunarYear) ? lunarYear : null,
    ganzhiYear,
    month,
    day,
    isLeapMonth,
    monthLabel,
    dayLabel,
    fullLabel: `农历${yearPrefix}${monthLabel}${dayLabel}`,
  };
}

type SolarTermFormulaSpec = {
  name: string;
  month: number;
  c21: number;
  preLeap: boolean;
  offsets: Record<number, number>;
};

/**
 * 寿星万年历 21 世纪（2000–2099 年）二十四节气通式常数及特殊年份微调表。
 */
const SOLAR_TERM_SPECS_21C: readonly SolarTermFormulaSpec[] = [
  { name: "小寒", month: 1, c21: 5.4055, preLeap: true, offsets: { 2019: -1, 2082: 1 } },
  { name: "大寒", month: 1, c21: 20.12, preLeap: true, offsets: { 2082: 1 } },
  { name: "立春", month: 2, c21: 3.87, preLeap: true, offsets: {} },
  { name: "雨水", month: 2, c21: 18.73, preLeap: true, offsets: { 2026: -1 } },
  { name: "惊蛰", month: 3, c21: 5.63, preLeap: false, offsets: {} },
  { name: "春分", month: 3, c21: 20.646, preLeap: false, offsets: { 2084: 1 } },
  { name: "清明", month: 4, c21: 4.81, preLeap: false, offsets: {} },
  { name: "谷雨", month: 4, c21: 20.1, preLeap: false, offsets: {} },
  { name: "立夏", month: 5, c21: 5.52, preLeap: false, offsets: { 2008: 1 } },
  { name: "小满", month: 5, c21: 21.04, preLeap: false, offsets: { 2008: 1 } },
  { name: "芒种", month: 6, c21: 5.678, preLeap: false, offsets: { 2002: 1 } },
  { name: "夏至", month: 6, c21: 21.37, preLeap: false, offsets: { 2028: 1 } },
  { name: "小暑", month: 7, c21: 7.108, preLeap: false, offsets: { 2016: 1 } },
  { name: "大暑", month: 7, c21: 22.83, preLeap: false, offsets: { 2022: 1 } },
  { name: "立秋", month: 8, c21: 7.5, preLeap: false, offsets: { 2002: 1 } },
  { name: "处暑", month: 8, c21: 23.13, preLeap: false, offsets: {} },
  { name: "白露", month: 9, c21: 7.646, preLeap: false, offsets: { 2027: 1 } },
  { name: "秋分", month: 9, c21: 23.042, preLeap: false, offsets: { 2042: 1 } },
  { name: "寒露", month: 10, c21: 8.318, preLeap: false, offsets: {} },
  { name: "霜降", month: 10, c21: 23.438, preLeap: false, offsets: { 2089: 1 } },
  { name: "立冬", month: 11, c21: 7.438, preLeap: false, offsets: { 2089: 1 } },
  { name: "小雪", month: 11, c21: 22.36, preLeap: false, offsets: {} },
  { name: "大雪", month: 12, c21: 7.18, preLeap: false, offsets: { 2054: 1 } },
  { name: "冬至", month: 12, c21: 21.94, preLeap: false, offsets: { 2021: -1 } },
];

export type SolarTermEntry = {
  name: string;
  year: number;
  month: number;
  day: number;
  dateKey: string;
};

export type SolarTermStatus = {
  currentSolarTerm: string | null;
  previousSolarTerm: { name: string; dateKey: string; daysAgo: number } | null;
  nextSolarTerm: { name: string; dateKey: string; daysUntil: number } | null;
};

/**
 * 计算指定公历年份（2000–2099）的全部二十四节气日期列表。
 */
export function getSolarTermsForYear(year: number): SolarTermEntry[] {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) {
    return [];
  }
  const y = year - 2000;
  const d = 0.2422;

  return SOLAR_TERM_SPECS_21C.map((spec) => {
    const leapCount = spec.preLeap
      ? Math.floor((y - 1) / 4)
      : Math.floor(y / 4);
    const day =
      Math.floor(y * d + spec.c21) - leapCount + (spec.offsets[year] ?? 0);
    return {
      name: spec.name,
      year,
      month: spec.month,
      day,
      dateKey: formatBeijingDateKeyFromYmd(year, spec.month, day),
    };
  });
}

/**
 * 计算给定日期当天命中的二十四节气，以及距离最近的前后节气。
 */
export function resolveSolarTermStatus(
  input: Date | string = new Date(),
): SolarTermStatus {
  const target =
    parseBeijingCalendarDate(input) ??
    parseBeijingCalendarDate(new Date())!;

  const candidates = [
    ...getSolarTermsForYear(target.year - 1),
    ...getSolarTermsForYear(target.year),
    ...getSolarTermsForYear(target.year + 1),
  ];

  if (candidates.length === 0) {
    return {
      currentSolarTerm: null,
      previousSolarTerm: null,
      nextSolarTerm: null,
    };
  }

  let currentSolarTerm: string | null = null;
  let previousSolarTerm: SolarTermStatus["previousSolarTerm"] = null;
  let nextSolarTerm: SolarTermStatus["nextSolarTerm"] = null;

  for (const term of candidates) {
    const delta = diffBeijingCalendarDays(target, term);
    if (delta === 0) {
      currentSolarTerm = term.name;
    } else if (delta < 0) {
      const daysAgo = -delta;
      if (!previousSolarTerm || daysAgo < previousSolarTerm.daysAgo) {
        previousSolarTerm = {
          name: term.name,
          dateKey: term.dateKey,
          daysAgo,
        };
      }
    } else {
      if (!nextSolarTerm || delta < nextSolarTerm.daysUntil) {
        nextSolarTerm = {
          name: term.name,
          dateKey: term.dateKey,
          daysUntil: delta,
        };
      }
    }
  }

  return {
    currentSolarTerm,
    previousSolarTerm,
    nextSolarTerm,
  };
}

const GREGORIAN_FESTIVALS: Readonly<Record<string, string>> = {
  "01-01": "元旦",
  "02-14": "情人节",
  "03-08": "妇女节",
  "05-01": "劳动节",
  "06-01": "儿童节",
  "10-01": "国庆节",
  "12-24": "平安夜",
  "12-25": "圣诞节",
  "12-31": "跨年夜",
};

const LUNAR_FESTIVALS: Readonly<Record<string, string>> = {
  "1-1": "春节",
  "1-15": "元宵节",
  "2-2": "龙抬头",
  "5-5": "端午节",
  "7-7": "七夕节",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节",
  "12-23": "北方小年",
  "12-24": "南方小年",
};

function detectFestivalsForDate(
  cal: BeijingCalendarDate,
  lunar: ChineseLunarDate,
  tomorrowLunar: ChineseLunarDate,
  currentSolarTerm: string | null,
): string[] {
  const festivals: string[] = [];

  // 1. 除夕：无论当年腊月是廿九（小月）还是三十（大月），正月初一的前一天恒为除夕
  if (
    !tomorrowLunar.isLeapMonth &&
    tomorrowLunar.month === 1 &&
    tomorrowLunar.day === 1
  ) {
    festivals.push("除夕");
  }

  // 2. 传统农历节日（仅在非闰月触发）
  if (!lunar.isLeapMonth) {
    const lunarFestival = LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`];
    if (lunarFestival) {
      festivals.push(lunarFestival);
    }
  }

  // 3. 节气联动传统法定节日：清明节
  if (currentSolarTerm === "清明") {
    festivals.push("清明节");
  }

  // 4. 公历现代/法定节日
  const mmdd = `${String(cal.month).padStart(2, "0")}-${String(cal.day).padStart(2, "0")}`;
  const gregorianFestival = GREGORIAN_FESTIVALS[mmdd];
  if (gregorianFestival) {
    festivals.push(gregorianFestival);
  }

  return Array.from(new Set(festivals));
}

export type CompanionMemoryItem = {
  title: string;
  description?: string | null;
  category?: string;
  date?: string | null;
};

export type TogetherMilestoneInfo = {
  startDateKey: string;
  daysElapsed: number;
  dayCount: number;
  anniversaryYears: number | null;
  isHundredDayMilestone: boolean;
  isSpecialNumberMilestone: boolean;
  milestoneLabel: string | null;
};

export type UpcomingMemoryAnniversary = {
  title: string;
  month: number;
  day: number;
  originYear: number | null;
  targetDateKey: string;
  daysUntil: number;
  yearsCount: number | null;
  isToday: boolean;
};

export type CalendarSensorOptions = {
  now?: Date;
  targetDate?: string | null;
  togetherFrom?: string | null;
  memories?: CompanionMemoryItem[];
};

export type CalendarSensorReportData = {
  date: BeijingCalendarDate;
  weekday: number;
  weekdayName: string;
  isWeekend: boolean;
  lunar: ChineseLunarDate;
  solarTerms: SolarTermStatus;
  festivals: string[];
  togetherInfo: TogetherMilestoneInfo | null;
  upcomingAnniversaries: UpcomingMemoryAnniversary[];
};

const SPECIAL_TOGETHER_DAY_NUMBERS = new Set([520, 1314]);

function computeTogetherMilestone(
  target: BeijingCalendarDate,
  togetherFrom: string | null | undefined,
): TogetherMilestoneInfo | null {
  // 旧角色资料支持只填写 YYYY-MM，缺少日时不推算精确纪念日。
  if (togetherFrom && /^\d{4}-\d{2}$/.test(togetherFrom.trim())) return null;
  const start = parseBeijingCalendarDate(togetherFrom);
  if (!start) return null;

  const daysElapsed = diffBeijingCalendarDays(start, target);
  if (daysElapsed < 0) return null;

  const dayCount = daysElapsed + 1;

  // 整周年判断（若起始为闰年 02-29，在平年 02-28 视作周年日）
  const effectiveAnnivDay = Math.min(
    start.day,
    getGregorianMonthDays(target.year, start.month),
  );
  const anniversaryYears =
    target.year > start.year &&
    target.month === start.month &&
    target.day === effectiveAnnivDay
      ? target.year - start.year
      : null;

  const isHundredDayMilestone = dayCount >= 100 && dayCount % 100 === 0;
  const isSpecialNumberMilestone = SPECIAL_TOGETHER_DAY_NUMBERS.has(dayCount);

  const labels: string[] = [];
  if (anniversaryYears !== null) {
    labels.push(`相识/在一起 ${anniversaryYears} 周年纪念日`);
  }
  if (isHundredDayMilestone || isSpecialNumberMilestone) {
    labels.push(`相识/在一起第 ${dayCount} 天纪念日`);
  }

  return {
    startDateKey: start.dateKey,
    daysElapsed,
    dayCount,
    anniversaryYears,
    isHundredDayMilestone,
    isSpecialNumberMilestone,
    milestoneLabel: labels.length > 0 ? labels.join("、") : null,
  };
}

const ANNIVERSARY_TITLE_PATTERN = /生日|纪念日|周年/;

function extractMonthDayFromMemory(
  item: CompanionMemoryItem,
): { originYear: number | null; month: number; day: number } | null {
  const sources = [item.date ?? "", item.title ?? "", item.description ?? ""];

  for (const raw of sources) {
    const text = raw.trim();
    if (!text) continue;

    // 匹配 YYYY-MM-DD / YYYY/MM/DD / YYYY年M月D日
    const fullMatch = text.match(
      /(?:^|\D)(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})(?:日|\b|\D)/,
    );
    if (fullMatch) {
      const originYear = Number.parseInt(fullMatch[1], 10);
      const month = Number.parseInt(fullMatch[2], 10);
      const day = Number.parseInt(fullMatch[3], 10);
      if (isValidGregorianDate(originYear, month, day)) {
        return { originYear, month, day };
      }
    }

    // 匹配无年份的 MM-DD / M月D日
    const mdChinese = text.match(/(?:^|\D)(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (mdChinese) {
      const month = Number.parseInt(mdChinese[1], 10);
      const day = Number.parseInt(mdChinese[2], 10);
      if (isValidGregorianDate(2024, month, day)) {
        return { originYear: null, month, day };
      }
    }

    const mdDash = text.match(/(?:^|[^\d-])(\d{1,2})-(\d{1,2})(?:$|[^\d-])/);
    if (mdDash) {
      const month = Number.parseInt(mdDash[1], 10);
      const day = Number.parseInt(mdDash[2], 10);
      if (isValidGregorianDate(2024, month, day)) {
        return { originYear: null, month, day };
      }
    }
  }

  return null;
}

function scanUpcomingMemoryAnniversaries(
  target: BeijingCalendarDate,
  memories: CompanionMemoryItem[] | undefined,
  maxDaysAhead = 3,
): UpcomingMemoryAnniversary[] {
  if (!Array.isArray(memories) || memories.length === 0) return [];

  const results: UpcomingMemoryAnniversary[] = [];
  const seenKeys = new Set<string>();

  for (const item of memories) {
    if (!item || typeof item.title !== "string" || !item.title.trim()) continue;
    const isAnniversaryItem =
      item.category === "anniversary" ||
      ANNIVERSARY_TITLE_PATTERN.test(item.title);
    if (!isAnniversaryItem) continue;

    const extracted = extractMonthDayFromMemory(item);
    if (!extracted) continue;

    // 枚举今年与明年，找到距离 target >= 0 的最近一次纪念日（兼容跨年如 12-30 看 01-01 及闰年 02-29）
    for (const candidateYear of [target.year, target.year + 1]) {
      const effectiveDay = Math.min(
        extracted.month === 2 && extracted.day === 29
          ? getGregorianMonthDays(candidateYear, 2)
          : extracted.day,
        getGregorianMonthDays(candidateYear, extracted.month),
      );
      if (!isValidGregorianDate(candidateYear, extracted.month, effectiveDay)) {
        continue;
      }
      const candidateCal: BeijingCalendarDate = {
        year: candidateYear,
        month: extracted.month,
        day: effectiveDay,
        dateKey: formatBeijingDateKeyFromYmd(
          candidateYear,
          extracted.month,
          effectiveDay,
        ),
      };
      const daysUntil = diffBeijingCalendarDays(target, candidateCal);
      if (daysUntil < 0) continue;

      if (daysUntil <= maxDaysAhead) {
        const dedupKey = `${item.title.trim()}|${candidateCal.dateKey}`;
        if (!seenKeys.has(dedupKey)) {
          seenKeys.add(dedupKey);
          const yearsCount =
            extracted.originYear !== null && candidateYear > extracted.originYear
              ? candidateYear - extracted.originYear
              : null;
          results.push({
            title: item.title.trim(),
            month: extracted.month,
            day: extracted.day,
            originYear: extracted.originYear,
            targetDateKey: candidateCal.dateKey,
            daysUntil,
            yearsCount,
            isToday: daysUntil === 0,
          });
        }
      }
      break;
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

const WEEKDAY_LABELS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

/**
 * 综合计算给定公历日期（或北京时间当前时刻）的农历、节气、节假日、相识里程碑与近期纪念日。
 */
export function analyzeCalendarAndAnniversaries(
  options: CalendarSensorOptions = {},
): CalendarSensorReportData {
  const baseDate = options.now ?? new Date();
  const target =
    (options.targetDate ? parseBeijingCalendarDate(options.targetDate) : null) ??
    parseBeijingCalendarDate(baseDate) ??
    parseBeijingCalendarDate(new Date())!;

  const weekday = new Date(
    Date.UTC(target.year, target.month - 1, target.day),
  ).getUTCDay();
  const weekdayName =
    WEEKDAY_LABELS[weekday] ?? getBeijingTimeParts(baseDate).weekdayName;
  const isWeekend = weekday === 0 || weekday === 6;

  const lunar = getChineseLunarDate(target.dateKey);
  const tomorrowCal = addBeijingCalendarDays(target, 1);
  const tomorrowLunar = getChineseLunarDate(tomorrowCal.dateKey);
  const solarTerms = resolveSolarTermStatus(target.dateKey);
  const festivals = detectFestivalsForDate(
    target,
    lunar,
    tomorrowLunar,
    solarTerms.currentSolarTerm,
  );
  const togetherInfo = computeTogetherMilestone(target, options.togetherFrom);
  const upcomingAnniversaries = scanUpcomingMemoryAnniversaries(
    target,
    options.memories,
    3,
  );

  return {
    date: target,
    weekday,
    weekdayName,
    isWeekend,
    lunar,
    solarTerms,
    festivals,
    togetherInfo,
    upcomingAnniversaries,
  };
}

function formatDaysUntilLabel(daysUntil: number): string {
  if (daysUntil === 0) return "就在今天";
  if (daysUntil === 1) return "在明天";
  if (daysUntil === 2) return "在后天";
  return `还有 ${daysUntil} 天`;
}

/**
 * 构建低噪声环境时间提示：
 * - 普通无事件工作日或普通周末一律返回 ""（空字符串），绝不每轮刷屏污染系统提示词；
 * - 仅在当天恰逢二十四节气、传统/公历节日、整百天/520/整周年纪念日、或 3 天内有生日/纪念日时返回简短 1–2 行内部提示。
 */
export function buildAmbientCalendarHint(
  options: CalendarSensorOptions = {},
): string {
  const report = analyzeCalendarAndAnniversaries(options);
  const highlights: string[] = [];

  if (report.festivals.length > 0) {
    highlights.push(`今天是${report.festivals.join("、")}`);
  }
  if (
    report.solarTerms.currentSolarTerm &&
    !(
      report.solarTerms.currentSolarTerm === "清明" &&
      report.festivals.includes("清明节")
    )
  ) {
    highlights.push(`今日恰逢二十四节气「${report.solarTerms.currentSolarTerm}」`);
  }
  if (report.togetherInfo?.milestoneLabel) {
    highlights.push(`今天是两人${report.togetherInfo.milestoneLabel}`);
  }
  for (const item of report.upcomingAnniversaries) {
    const mmdd = `${String(item.month).padStart(2, "0")}-${String(item.day).padStart(2, "0")}`;
    highlights.push(
      `纪念事项「${item.title}（${mmdd}）」${formatDaysUntilLabel(item.daysUntil)}`,
    );
  }

  if (highlights.length === 0) {
    return "";
  }

  return (
    `【时令与纪念日轻提示】今天是 ${report.date.dateKey} ${report.weekdayName}（${report.lunar.fullLabel}）：${highlights.join("；")}。\n` +
    `仅在语境契合时用你平时的口吻自然带出一句惦记或问候，切勿像日历播报员一样报菜名。`
  );
}

/**
 * 供原生工具 get_calendar_and_anniversaries 主动调用时返回的完整结构化中文报告。
 */
export function queryCalendarAndAnniversaries(
  options: CalendarSensorOptions = {},
): string {
  if (options.targetDate && !parseBeijingCalendarDate(options.targetDate)) {
    return "目标日期无效，请使用 YYYY-MM-DD 格式。";
  }
  const report = analyzeCalendarAndAnniversaries(options);
  const lines: string[] = [];

  const dayTypeLabel = report.isWeekend ? "周末" : "周一至周五";
  lines.push(
    `公历日期：${report.date.dateKey} ${report.weekdayName}（${dayTypeLabel}）`,
  );
  lines.push(`农历日期：${report.lunar.fullLabel}`);

  const termParts: string[] = [];
  if (report.solarTerms.currentSolarTerm) {
    termParts.push(`今日恰逢「${report.solarTerms.currentSolarTerm}」`);
  } else if (report.solarTerms.previousSolarTerm) {
    termParts.push(
      `上一节气为「${report.solarTerms.previousSolarTerm.name}」（${report.solarTerms.previousSolarTerm.daysAgo} 天前）`,
    );
  }
  if (report.solarTerms.nextSolarTerm) {
    termParts.push(
      `下一节气为「${report.solarTerms.nextSolarTerm.name}」（${report.solarTerms.nextSolarTerm.dateKey}，还有 ${report.solarTerms.nextSolarTerm.daysUntil} 天）`,
    );
  }
  if (termParts.length > 0) {
    lines.push(`二十四节气：${termParts.join("；")}`);
  }

  if (report.festivals.length > 0) {
    lines.push(`今日节日：${report.festivals.join("、")}`);
  } else {
    lines.push(`今日节日：本地历法表无节日条目`);
  }

  if (report.togetherInfo) {
    const milestoneSuffix = report.togetherInfo.milestoneLabel
      ? `（今日恰逢：${report.togetherInfo.milestoneLabel}）`
      : "";
    lines.push(
      `相识与陪伴天数：第 ${report.togetherInfo.dayCount} 天（自 ${report.togetherInfo.startDateKey} 起，已满 ${report.togetherInfo.daysElapsed} 天）${milestoneSuffix}`,
    );
  }

  if (report.upcomingAnniversaries.length > 0) {
    const itemsText = report.upcomingAnniversaries
      .map((item) => {
        const yearsNote =
          item.yearsCount !== null ? `（满 ${item.yearsCount} 周年/岁）` : "";
        return `${item.title}（${item.targetDateKey}，${formatDaysUntilLabel(item.daysUntil)}）${yearsNote}`;
      })
      .join("；");
    lines.push(`近期生日与纪念日（3 天内）：${itemsText}`);
  } else if (options.memories && options.memories.length > 0) {
    lines.push(`近期生日与纪念日（3 天内）：近 3 天暂无待提醒的生日或纪念日`);
  }

  return lines.join("\n");
}
