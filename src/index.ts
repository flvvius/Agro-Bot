import { Hono } from "hono";
import { getBot } from "./bot";
import { getWeatherForecast } from "./services/weather";
import { getBrmPrices } from "./services/prices";
import { getApiaDeadlines } from "./services/apia";

type Bindings = {
  DB?: D1Database;
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_VERIFY_TOKEN: string;
  GEMINI_API_KEY: string;
};

type WhatsAppIncomingMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
};

async function buildResponseText(text: string): Promise<string> {
  const normalized = text.toLowerCase().trim();

  if (normalized === "ajutor") {
    return [
      "Comenzi disponibile:",
      "- ajutor",
      "- vreme <localitate>",
      "- preturi",
      "- apia",
    ].join("\n");
  }

  if (normalized.startsWith("vreme")) {
    const location = normalized.replace("vreme", "").trim();
    if (!location) return "Spune-mi si localitatea. Exemplu: vreme Craiova";
    return getWeatherForecast(location);
  }

  if (normalized === "preturi") {
    return getBrmPrices();
  }

  if (normalized === "apia") {
    return getApiaDeadlines();
  }

  return "Salut! Sunt AgroBot. Trimite 'ajutor' pentru comenzi.";
}

async function sendWhatsAppText(
  env: Bindings,
  to: string,
  text: string,
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error("[webhook] outbound send failed", {
      status: response.status,
      body,
      to,
    });
    return;
  }

  console.log("[webhook] outbound send ok", { to, status: response.status });
}

async function saveFarmerActivity(env: Bindings, phone: string): Promise<void> {
  if (!env.DB) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `
      CREATE TABLE IF NOT EXISTS farmers (
        id TEXT PRIMARY KEY,
        phone TEXT,
        name TEXT,
        location TEXT,
        crops TEXT,
        created_at INTEGER,
        last_active INTEGER
      )
    `,
  ).run();

  await env.DB.prepare(
    `
      INSERT INTO farmers (id, phone, created_at, last_active)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(id) DO UPDATE SET
        last_active = excluded.last_active,
        phone = excluded.phone
    `,
  )
    .bind(phone, phone, now, now)
    .run();
}

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => c.text("AgroBot OK"));
app.get("/webhook", (c) =>
  getBot(c.env).webhooks.whatsapp(c.req.raw, {
    waitUntil: (task) => c.executionCtx.waitUntil(task),
  }),
);
app.post("/webhook", async (c) => {
  const request = c.req.raw;
  let parsedPayload: {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: WhatsAppIncomingMessage[];
          statuses?: unknown[];
        };
      }>;
    }>;
  } | null = null;

  try {
    parsedPayload = (await request.clone().json()) as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: WhatsAppIncomingMessage[];
            statuses?: unknown[];
          };
        }>;
      }>;
    };
    const value = parsedPayload.entry?.[0]?.changes?.[0]?.value;
    const messageCount = value?.messages?.length ?? 0;
    const statusCount = value?.statuses?.length ?? 0;

    console.log("[webhook] incoming", {
      messageCount,
      statusCount,
      hasMessages: messageCount > 0,
    });
  } catch {
    console.log("[webhook] incoming non-json payload");
  }

  const value = parsedPayload?.entry?.[0]?.changes?.[0]?.value;
  const messageCount = value?.messages?.length ?? 0;
  const statusCount = value?.statuses?.length ?? 0;

  // Fast-path status callbacks (delivered/read/failed) without extra processing.
  if (messageCount === 0 && statusCount > 0) {
    return c.text("OK");
  }

  const firstMessage = value?.messages?.[0];
  const from = firstMessage?.from;
  const text = firstMessage?.text?.body?.trim();

  if (from && text) {
    try {
      await saveFarmerActivity(c.env, from);
      const responseText = await buildResponseText(text);
      await sendWhatsAppText(c.env, from, responseText);
      return c.text("OK");
    } catch (error) {
      console.error("[webhook] direct handler error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.text("OK");
    }
  }

  // Fallback to SDK handler only for non-text edge cases.
  return getBot(c.env).webhooks.whatsapp(request, {
    waitUntil: (task) => c.executionCtx.waitUntil(task),
  });
});

export default app;
