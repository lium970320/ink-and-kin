import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEATHER_UNAVAILABLE_FALLBACK_SUMMARY,
  analyzeCalendarAndAnniversaries,
  buildAmbientCalendarHint,
  getChineseLunarDate,
  getDualCityWeatherSummary,
  readCompanionCities,
  normalizeCityName,
  queryCalendarAndAnniversaries,
  resetWorldSensorCacheForTests,
  resolveSolarTermStatus,
} from "./world-sensors";

describe("外部世界传感器 world-sensors", () => {
  beforeEach(() => {
    resetWorldSensorCacheForTests();
  });

  describe("双城实时天气与温差传感器", () => {
    it("解析双城实时天气、去掉行政区后缀并自动计算双城温差", async () => {
      const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        // 南京纬度约 32.06
        if (url.includes("latitude=32.0603")) {
          return new Response(
            JSON.stringify({
              current: {
                temperature_2m: 14.1,
                apparent_temperature: 11.8,
                weather_code: 61,
                wind_speed_10m: 12.5,
                relative_humidity_2m: 86,
              },
              daily: {
                temperature_2m_max: [16.2, 18.0],
                temperature_2m_min: [10.9, 9.5],
                precipitation_probability_max: [80, 20],
              },
            }),
            { status: 200 },
          );
        }
        // 武汉纬度约 30.59
        return new Response(
          JSON.stringify({
            current: {
              temperature_2m: 19.2,
              apparent_temperature: 18.4,
              weather_code: 2,
              wind_speed_10m: 6.0,
              relative_humidity_2m: 58,
            },
            daily: {
              temperature_2m_max: [22.1, 23.4],
              temperature_2m_min: [14.8, 15.2],
              precipitation_probability_max: [15, 10],
            },
          }),
          { status: 200 },
        );
      });

      const result = await getDualCityWeatherSummary({
        personaCity: "南京市",
        userCity: "武汉",
        now: new Date("2026-11-14T10:00:00+08:00"),
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(result.ok).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.cities).toHaveLength(2);
      expect(result.summary).toContain("南京当前 14°C 小雨");
      expect(result.summary).toContain("体感 12°C");
      expect(result.summary).toContain("今日 11~16°C");
      expect(result.summary).toContain("武汉当前 19°C 多云");
      expect(result.summary).toContain("南京比武汉低约 5°C");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("命中 30 分钟进程内内存缓存时不重复发起 fetch，超过 30 分钟后自动刷新", async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            current: {
              temperature_2m: 21,
              apparent_temperature: 20,
              weather_code: 0,
            },
            daily: {
              temperature_2m_max: [25],
              temperature_2m_min: [16],
              precipitation_probability_max: [5],
            },
          }),
          { status: 200 },
        );
      });

      const t0 = new Date("2026-10-15T09:00:00+08:00");
      const first = await getDualCityWeatherSummary({
        personaCity: "杭州",
        userCity: "深圳",
        now: t0,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      expect(first.ok).toBe(true);
      expect(first.fromCache).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // 10 分钟后再次查询（即使带“市”后缀也命中同一规范化城市缓存）
      const t10m = new Date(t0.getTime() + 10 * 60 * 1000);
      const second = await getDualCityWeatherSummary({
        personaCity: "杭州市",
        userCity: "深圳市",
        now: t10m,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      expect(second.ok).toBe(true);
      expect(second.fromCache).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // 31 分钟后缓存过期，重新请求上游
      const t31m = new Date(t0.getTime() + 31 * 60 * 1000);
      const third = await getDualCityWeatherSummary({
        personaCity: "杭州",
        userCity: "深圳",
        now: t31m,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      expect(third.ok).toBe(true);
      expect(third.fromCache).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("对不在内置速查表中的城市自动回退调用 Open-Meteo Geocoding API 解析经纬度", async () => {
      const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("geocoding-api.open-meteo.com")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  name: "景德镇",
                  latitude: 29.2688,
                  longitude: 117.1784,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            current: {
              temperature_2m: 17.6,
              apparent_temperature: 17.0,
              weather_code: 1,
            },
            daily: {
              temperature_2m_max: [21],
              temperature_2m_min: [12],
              precipitation_probability_max: [10],
            },
          }),
          { status: 200 },
        );
      });

      const res = await getDualCityWeatherSummary({
        requestedCities: ["景德镇市"],
        now: new Date("2026-11-01T12:00:00+08:00"),
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(res.ok).toBe(true);
      expect(res.summary).toContain("景德镇当前 18°C 晴间多云");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("在 API 返回 500 或网络超时挂起时静默返回无幻觉降级提示且绝不抛异常", async () => {
      const errorFetch = vi.fn(async () => new Response("Internal Error", { status: 500 }));
      const failed500 = await getDualCityWeatherSummary({
        personaCity: "北京",
        userCity: "上海",
        fetchImpl: errorFetch as unknown as typeof fetch,
      });
      expect(failed500.ok).toBe(false);
      expect(failed500.summary).toBe(WEATHER_UNAVAILABLE_FALLBACK_SUMMARY);

      const hangingFetch = vi.fn(
        () => new Promise<Response>(() => {
          // 模拟挂起不响应的网络连接
        }),
      );
      const timedOut = await getDualCityWeatherSummary({
        personaCity: "成都",
        timeoutMs: 200,
        fetchImpl: hangingFetch as unknown as typeof fetch,
      });
      expect(timedOut.ok).toBe(false);
      expect(timedOut.summary).toBe(WEATHER_UNAVAILABLE_FALLBACK_SUMMARY);
    });
  });

  it("只读取当前角色资料里的显式城市配置", () => {
    expect(normalizeCityName("乌鲁木齐市")).toBe("乌鲁木齐");
    expect(normalizeCityName("New York")).toBe("New York");
    expect(readCompanionCities({ profileSections: { life: { settingLine: "常驻杭州" } } })).toEqual({
      personaCity: "",
      userCity: "",
    });
    expect(readCompanionCities({ profileSections: { life: { city: "成都市", userCity: "重庆市" } } })).toEqual({
      personaCity: "成都",
      userCity: "重庆",
    });
  });

  describe("农历、二十四节气、节假日与角色纪念日传感器", () => {
    it("零依赖精准识别春节、小月除夕、七夕、中秋及农历闰月", () => {
      // 2026-02-16 为乙巳年腊月廿九（当年腊月为小月无三十，次日即正月初一，应精准识别为除夕）
      const eve2026 = analyzeCalendarAndAnniversaries({
        targetDate: "2026-02-16",
      });
      expect(eve2026.lunar.month).toBe(12);
      expect(eve2026.lunar.day).toBe(29);
      expect(eve2026.festivals).toContain("除夕");

      // 2026-02-17 为丙午年正月初一春节
      const spring2026 = analyzeCalendarAndAnniversaries({
        targetDate: "2026-02-17",
      });
      expect(spring2026.lunar.month).toBe(1);
      expect(spring2026.lunar.day).toBe(1);
      expect(spring2026.lunar.isLeapMonth).toBe(false);
      expect(spring2026.festivals).toContain("春节");

      // 2025-07-25 为乙巳年闰六月初一（正确识别闰月标识）
      const leapMonth = getChineseLunarDate("2025-07-25");
      expect(leapMonth.isLeapMonth).toBe(true);
      expect(leapMonth.month).toBe(6);
      expect(leapMonth.monthLabel).toBe("闰六月");
      expect(leapMonth.dayLabel).toBe("初一");

      // 2025-08-29 七夕节（农历七月初七）与 2026-09-25 中秋节（农历八月十五）
      const qixi = analyzeCalendarAndAnniversaries({ targetDate: "2025-08-29" });
      expect(qixi.festivals).toContain("七夕节");

      const midAutumn = analyzeCalendarAndAnniversaries({
        targetDate: "2026-09-25",
      });
      expect(midAutumn.festivals).toContain("中秋节");
    });

    it("精确计算二十四节气（含清明、立冬、冬至及前后节气距离）", () => {
      const qingming = analyzeCalendarAndAnniversaries({
        targetDate: "2026-04-05",
      });
      expect(qingming.solarTerms.currentSolarTerm).toBe("清明");
      expect(qingming.festivals).toContain("清明节");

      const lidong = resolveSolarTermStatus("2026-11-07");
      expect(lidong.currentSolarTerm).toBe("立冬");
      expect(lidong.nextSolarTerm?.name).toBe("小雪");

      const dongzhi = resolveSolarTermStatus("2026-12-22");
      expect(dongzhi.currentSolarTerm).toBe("冬至");
      // 跨年下一节气应为 2027-01-05 小寒
      expect(dongzhi.nextSolarTerm?.name).toBe("小寒");
      expect(dongzhi.nextSolarTerm?.dateKey).toBe("2027-01-05");
    });

    it("准确计算 togetherFrom 第 100 天 / 520 天 / 整周年及 memories 3 天内生日提醒", () => {
      // 2026-01-01 起算：2026-04-10 为第 100 天
      const day100 = analyzeCalendarAndAnniversaries({
        targetDate: "2026-04-10",
        togetherFrom: "2026-01-01",
      });
      expect(day100.togetherInfo?.dayCount).toBe(100);
      expect(day100.togetherInfo?.daysElapsed).toBe(99);
      expect(day100.togetherInfo?.isHundredDayMilestone).toBe(true);
      expect(day100.togetherInfo?.milestoneLabel).toContain("100");

      // 2026-01-01 起算：2027-06-04 为第 520 天
      const day520 = analyzeCalendarAndAnniversaries({
        targetDate: "2027-06-04",
        togetherFrom: "2026-01-01",
      });
      expect(day520.togetherInfo?.dayCount).toBe(520);
      expect(day520.togetherInfo?.isSpecialNumberMilestone).toBe(true);
      expect(day520.togetherInfo?.milestoneLabel).toContain("520");

      // 2027-01-01 满 1 周年 + 近期生日（2 天后）提醒
      const annivAndBirthdayHint = buildAmbientCalendarHint({
        now: new Date("2027-01-01T09:30:00+08:00"),
        togetherFrom: "2026-01-01",
        memories: [
          {
            title: "对方生日",
            category: "anniversary",
            date: "1999-01-03",
          },
          {
            title: "远期纪念日（超过3天不应进入近期提醒）",
            category: "anniversary",
            date: "01-20",
          },
        ],
      });
      expect(annivAndBirthdayHint).toContain("元旦");
      expect(annivAndBirthdayHint).toContain("1 周年纪念日");
      expect(annivAndBirthdayHint).toContain("对方生日（01-03）");
      expect(annivAndBirthdayHint).toContain("在后天");
      expect(annivAndBirthdayHint).not.toContain("远期纪念日");
    });

    it("在普通无事件工作日 buildAmbientCalendarHint 严格返回空字符串，而主动查询仍输出完整报告", () => {
      // 2026-11-12 星期四：非节气、非传统/公历节日、第 316 天非里程碑、3 天内无生日
      const options = {
        now: new Date("2026-11-12T15:00:00+08:00"),
        togetherFrom: "2026-01-01",
        memories: [
          {
            title: "测试纪念日",
            category: "anniversary",
            date: "05-20",
          },
        ],
      };

      const ambientHint = buildAmbientCalendarHint(options);
      expect(ambientHint).toBe("");

      const fullReport = queryCalendarAndAnniversaries(options);
      expect(fullReport).toContain("2026-11-12 星期四（周一至周五）");
      expect(fullReport).toContain("农历");
      expect(fullReport).toContain("二十四节气");
      expect(fullReport).toContain("第 316 天");
    });
  });
});
