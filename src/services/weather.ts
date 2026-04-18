type GeocodingResult = {
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
};

type ForecastDaily = {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
};

function formatDay(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function getRainLabel(rainMm: number): string {
  if (rainMm <= 0.5) return "fara ploaie";
  if (rainMm <= 4) return "ploaie usoara";
  if (rainMm <= 12) return "ploaie moderata";
  return "ploaie abundenta";
}

function getWindLabel(windKmh: number): string {
  if (windKmh < 15) return "slab";
  if (windKmh <= 25) return "moderat";
  return "puternic";
}

function getFieldAdvice(rainMm: number, windKmh: number): string {
  if (rainMm > 4) return "EVITA stropirea (risc spalare tratament)";
  if (windKmh > 25) return "ATENTIE la tratamente (vant puternic)";
  return "BINE pentru lucrari si tratamente";
}

async function geocodeLocation(
  location: string,
): Promise<GeocodingResult | null> {
  const geoUrl =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}` +
    "&count=1&language=ro&format=json";

  const response = await fetch(geoUrl);
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    results?: GeocodingResult[];
  };

  if (!data.results?.length) {
    return null;
  }

  return data.results[0];
}

async function getForecast(
  latitude: number,
  longitude: number,
  forecastDays: number,
): Promise<ForecastDaily | null> {
  const weatherUrl =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude}` +
    `&longitude=${longitude}` +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max" +
    "&timezone=Europe%2FBucharest" +
    `&forecast_days=${forecastDays}`;

  const response = await fetch(weatherUrl);
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    daily?: ForecastDaily;
  };

  return data.daily ?? null;
}

export async function getWeatherForecast(location: string): Promise<string> {
  const cleaned = location.trim();
  if (!cleaned) {
    return "Spune-mi si localitatea. Exemplu: vreme Craiova";
  }

  try {
    const geo = await geocodeLocation(cleaned);
    if (!geo) {
      return `Nu am gasit localitatea \"${cleaned}\". Incearca alt nume.`;
    }

    const daily = await getForecast(geo.latitude, geo.longitude, 5);
    if (!daily) {
      return "Nu am putut prelua prognoza acum. Incearca din nou in cateva minute.";
    }

    const rows: string[] = [];
    for (let i = 0; i < Math.min(5, daily.time.length); i += 1) {
      const label = formatDay(daily.time[i]);
      const tMin = Math.round(daily.temperature_2m_min[i]);
      const tMax = Math.round(daily.temperature_2m_max[i]);
      const rain = daily.precipitation_sum[i];
      const wind = Math.round(daily.wind_speed_10m_max[i]);
      const rainLabel = getRainLabel(rain);
      const windLabel = getWindLabel(wind);
      const advice = getFieldAdvice(rain, wind);

      rows.push(
        [
          `${i + 1}. ${label.toUpperCase()}`,
          `   Temperatura: ${tMin}C ... ${tMax}C`,
          `   Ploaie: ${rain} mm (${rainLabel})`,
          `   Vant: ${wind} km/h (${windLabel})`,
          `   Pentru camp: ${advice}`,
        ].join("\n"),
      );
    }

    return [
      `PROGNOZA PE 5 ZILE - ${geo.name.toUpperCase()}`,
      "----------------------------------------",
      ...rows.flatMap((block, idx) =>
        idx < rows.length - 1
          ? [block, "----------------------------------------"]
          : [block],
      ),
      "",
      "Legenda rapida:",
      "- BINE = conditii bune pentru tratamente",
      "- ATENTIE = verificare suplimentara inainte de stropire",
      "- EVITA = mai bine amanat tratamentul",
    ].join("\n");
  } catch {
    return "Eroare la preluarea vremii. Incearca din nou.";
  }
}

export async function getWeatherTreatmentWindow(
  location: string,
): Promise<string | null> {
  const cleaned = location.trim();
  if (!cleaned) {
    return null;
  }

  try {
    const geo = await geocodeLocation(cleaned);
    if (!geo) {
      return null;
    }

    const daily = await getForecast(geo.latitude, geo.longitude, 3);
    if (!daily) {
      return null;
    }

    const lines: string[] = [];
    for (let i = 0; i < Math.min(3, daily.time.length); i += 1) {
      const label = formatDay(daily.time[i]);
      const tMin = Math.round(daily.temperature_2m_min[i]);
      const tMax = Math.round(daily.temperature_2m_max[i]);
      const rain = daily.precipitation_sum[i];
      const wind = Math.round(daily.wind_speed_10m_max[i]);

      const recommendations: string[] = [];
      if (rain <= 1) recommendations.push("favorabil stropire");
      if (rain > 1) recommendations.push("evita stropire inainte de ploaie");
      if (wind > 25) recommendations.push("vant puternic");

      let line = `${label}: ${tMin}/${tMax}C, ploaie ${rain}mm`;
      if (recommendations.length > 0) {
        line += ` (${recommendations.join(", ")})`;
      }
      lines.push(line);
    }

    return [`Fereastra meteo 3 zile (${geo.name}):`, ...lines].join("\n");
  } catch {
    return null;
  }
}
