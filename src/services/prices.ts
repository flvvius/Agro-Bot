type Commodity = {
  key: string;
  label: string;
  aliases: RegExp[];
};

const BRM_URL = "https://brm.ro/cotatii-cereale/";

const COMMODITIES: Commodity[] = [
  {
    key: "grau",
    label: "Grau",
    aliases: [/grau/i, /grau\s+panificatie/i],
  },
  {
    key: "porumb",
    label: "Porumb",
    aliases: [/porumb/i],
  },
  {
    key: "rapita",
    label: "Rapita",
    aliases: [/rapita/i],
  },
  {
    key: "floarea",
    label: "Floarea-soarelui",
    aliases: [/floarea/i, /floarea[-\s]soarelui/i],
  },
];

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

function extractNearbyPrice(text: string, alias: RegExp): string | null {
  const match = alias.exec(text);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = Math.max(0, match.index - 30);
  const end = Math.min(text.length, match.index + 220);
  const segment = text.slice(start, end);

  const priceMatch = segment.match(
    /(\d{3,4}(?:[\.,]\d{1,2})?)\s*(?:lei|ron)?\s*\/?\s*t/i,
  );
  if (!priceMatch) {
    const fallback = segment.match(/\b(\d{3,4}(?:[\.,]\d{1,2})?)\b/);
    return fallback?.[1] ?? null;
  }

  return priceMatch[1];
}

export async function getBrmPrices(): Promise<string> {
  try {
    const response = await fetch(BRM_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 AgroBot/1.0",
      },
    });

    if (!response.ok) {
      return "Nu pot prelua cotatiile BRM acum. Incearca mai tarziu.";
    }

    const html = await response.text();
    const text = cleanHtml(html);

    const lines: string[] = [];
    let found = 0;

    for (const commodity of COMMODITIES) {
      let price: string | null = null;
      for (const alias of commodity.aliases) {
        price = extractNearbyPrice(text, alias);
        if (price) break;
      }

      if (price) {
        found += 1;
        lines.push(`- ${commodity.label}: ${price} lei/t`);
      }
    }

    if (found < 2) {
      return "Nu am reusit sa extrag cotatii BRM corecte acum. Verifica din nou in cateva minute.";
    }

    return [
      "Cotatii BRM (estimare automata):",
      ...lines,
      `Sursa: ${BRM_URL}`,
    ].join("\n");
  } catch {
    return "Eroare la preluarea cotatiilor BRM. Incearca din nou.";
  }
}
