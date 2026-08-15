import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';

const WEATHER_CACHE_KEY = 'ump_local_weather_v1';
const WEATHER_CACHE_MS = 30 * 60 * 1000;

type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'night';
type WeatherKind = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

type WeatherSnapshot = {
  temperature: number;
  feelsLike: number;
  weatherCode: number;
  windSpeed: number;
  isDay: boolean;
  place: string;
  fetchedAt: number;
};

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    is_day?: number;
  };
};

export type AdaptiveTheme = {
  period: TimePeriod;
  kind: WeatherKind;
  gradient: readonly [string, string, string];
  pageGradient: readonly [string, string, string];
  glow: string;
  accent: string;
  icon: keyof typeof Ionicons.glyphMap;
  greeting: string;
  condition: string;
  message: string;
  dark: boolean;
};

const periodNow = (): TimePeriod => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
};

const kindFromCode = (code?: number): WeatherKind => {
  if (code == null) return 'clear';
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'partly-cloudy';
};

const themeFor = (period: TimePeriod, kind: WeatherKind): AdaptiveTheme => {
  const periodThemes: Record<TimePeriod, Omit<AdaptiveTheme, 'kind' | 'condition' | 'icon' | 'message'>> = {
    morning: {
      period: 'morning',
      gradient: ['#275D8C', '#5EA3C8', '#F0B77A'],
      pageGradient: ['#EAF5FB', '#F4F7FB', '#FFF7EC'],
      glow: 'rgba(255,205,128,0.55)',
      accent: '#FFE2A8',
      greeting: 'Good morning',
      dark: true,
    },
    afternoon: {
      period: 'afternoon',
      gradient: ['#155AA3', '#398DD0', '#6FC8DF'],
      pageGradient: ['#E7F4FA', '#F4F7FB', '#EEF3FF'],
      glow: 'rgba(255,230,151,0.48)',
      accent: '#FFDA78',
      greeting: 'Good afternoon',
      dark: true,
    },
    evening: {
      period: 'evening',
      gradient: ['#3D3E7A', '#86619B', '#E28E79'],
      pageGradient: ['#F2EDF8', '#F7F5FA', '#FFF0EA'],
      glow: 'rgba(255,170,125,0.45)',
      accent: '#FFD098',
      greeting: 'Good evening',
      dark: true,
    },
    night: {
      period: 'night',
      gradient: ['#07162E', '#172E5B', '#33477B'],
      pageGradient: ['#E9EEF8', '#F4F7FB', '#EEF0F8'],
      glow: 'rgba(135,164,255,0.34)',
      accent: '#C8D6FF',
      greeting: 'Good night',
      dark: true,
    },
  };

  const weather: Record<WeatherKind, Pick<AdaptiveTheme, 'condition' | 'icon' | 'message'>> = {
    clear: {
      condition: period === 'night' ? 'Clear night' : 'Clear sky',
      icon: period === 'night' ? 'moon' : 'sunny',
      message: period === 'night' ? 'A calm night for one focused revision.' : 'Clear skies, clear goals. Make this session count.',
    },
    'partly-cloudy': {
      condition: 'Partly cloudy',
      icon: period === 'night' ? 'cloudy-night' : 'partly-sunny',
      message: 'A balanced day for steady, distraction-free progress.',
    },
    cloudy: { condition: 'Cloudy', icon: 'cloud', message: 'Quiet skies are perfect for deep, focused work.' },
    fog: { condition: 'Misty', icon: 'water', message: 'Take the next topic one clear step at a time.' },
    rain: { condition: 'Rain nearby', icon: 'rainy', message: 'Rain outside, focus inside. Settle in for a strong session.' },
    snow: { condition: 'Snowy', icon: 'snow', message: 'Stay warm, slow down and learn with intention.' },
    storm: { condition: 'Thunderstorm', icon: 'thunderstorm', message: 'Stay safe indoors and keep today’s target realistic.' },
  };

  const base = periodThemes[period];
  if (kind === 'rain') {
    base.gradient = ['#193A57', '#37647A', '#668A96'];
    base.pageGradient = ['#E6EFF2', '#F3F7F8', '#EAF0F5'];
    base.glow = 'rgba(150,210,225,0.3)';
  } else if (kind === 'storm') {
    base.gradient = ['#101A35', '#343C63', '#53607B'];
    base.pageGradient = ['#E8EBF2', '#F4F5F8', '#ECEEF4'];
    base.glow = 'rgba(176,190,255,0.25)';
  } else if (kind === 'cloudy' || kind === 'fog') {
    base.gradient = period === 'night' ? ['#101C34', '#34425D', '#667286'] : ['#466379', '#7792A1', '#A9B8BD'];
    base.pageGradient = ['#EAF0F2', '#F5F7F8', '#EDF2F4'];
  } else if (kind === 'snow') {
    base.gradient = ['#416B91', '#7FA9C1', '#B9D9E5'];
    base.pageGradient = ['#EBF7FA', '#F7FBFC', '#EEF5FA'];
  }

  return { ...base, kind, ...weather[kind] };
};

const placeName = (address?: Location.LocationGeocodedAddress) =>
  address?.city || address?.subregion || address?.district || address?.region || 'Current location';

const fetchWithTimeout = async (url: string, timeoutMs = 12_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export const useWeatherTheme = () => {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [period, setPeriod] = useState<TimePeriod>(periodNow());

  const refresh = useCallback(async () => {
    setLoading(true);
    setWeatherError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPermissionDenied(true);
        throw new Error('Location permission is off. Using local time instead.');
      }
      setPermissionDenied(false);

      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000, requiredAccuracy: 5000 });
      const position = lastKnown || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;

      const [weatherResponse, addresses] = await Promise.all([
        fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&current=temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&timezone=auto`),
        Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []),
      ]);
      if (!weatherResponse.ok) throw new Error('Live weather is temporarily unavailable.');
      const payload = await weatherResponse.json() as OpenMeteoResponse;
      if (!payload.current || payload.current.temperature_2m == null) throw new Error('Live weather is temporarily unavailable.');

      const next: WeatherSnapshot = {
        temperature: payload.current.temperature_2m,
        feelsLike: payload.current.apparent_temperature ?? payload.current.temperature_2m,
        weatherCode: payload.current.weather_code ?? 0,
        windSpeed: payload.current.wind_speed_10m ?? 0,
        isDay: payload.current.is_day !== 0,
        place: placeName(addresses[0]),
        fetchedAt: Date.now(),
      };
      setWeather(next);
      await AsyncStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(next));
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : 'Weather is unavailable. Using local time instead.');
    } finally {
      setLoading(false);
      setPeriod(periodNow());
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const start = async () => {
      try {
        const cached = await AsyncStorage.getItem(WEATHER_CACHE_KEY);
        if (cached && mounted) {
          const parsed = JSON.parse(cached) as WeatherSnapshot;
          setWeather(parsed);
          if (Date.now() - parsed.fetchedAt < WEATHER_CACHE_MS) return;
        }
      } catch { /* time-based theme remains available */ }
      if (mounted) refresh();
    };
    start();
    const timer = setInterval(() => setPeriod(periodNow()), 60_000);
    return () => { mounted = false; clearInterval(timer); };
  }, [refresh]);

  const kind = kindFromCode(weather?.weatherCode);
  const theme = useMemo(() => themeFor(period, kind), [kind, period]);

  return {
    weather,
    theme,
    loading,
    permissionDenied,
    weatherError,
    refreshWeather: refresh,
    isLive: Boolean(weather),
  };
};
