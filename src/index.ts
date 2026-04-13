import { Hono } from "hono";
import { getBot } from "./bot";
import { getWeatherForecast, getWeatherTreatmentWindow } from "./services/weather";
import { getBrmPrices } from "./services/prices";
import { getApiaDeadlines } from "./services/apia";
import { diagnoseFromWhatsAppMedia } from "./services/diagnosis";

type Bindings = {
  DB?: D1Database;
  BUCKET?: R2Bucket;
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
  image?: { id?: string };
};

type FarmerRow = {
  id: string;
  phone: string | null;
  name: string | null;
  location: string | null;
  crops: string | null;
  onboarding_step: string | null;
  onboarding_completed: number | null;
};

type DiagnosisRow = {
  id: string;
  farmer_id: string;
  image_key: string;
  diagnosis: string;
  confidence: string;
  gemini_response: string;
  feedback_correct: number | null;
  created_at: number;
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

async function ensureFarmerTable(env: Bindings): Promise<void> {
  if (!env.DB) return;

  await env.DB.prepare(
    `
      CREATE TABLE IF NOT EXISTS farmers (
        id TEXT PRIMARY KEY,
        phone TEXT,
        name TEXT,
        location TEXT,
        crops TEXT,
        onboarding_step TEXT,
        onboarding_completed INTEGER DEFAULT 0,
        created_at INTEGER,
        last_active INTEGER
      )
    `,
  ).run();

  try {
    await env.DB.prepare(
      "ALTER TABLE farmers ADD COLUMN onboarding_step TEXT",
    ).run();
  } catch {
    // no-op if already exists
  }

  try {
    await env.DB.prepare(
      "ALTER TABLE farmers ADD COLUMN onboarding_completed INTEGER DEFAULT 0",
    ).run();
  } catch {
    // no-op if already exists
  }
}

async function getOrCreateFarmer(
  env: Bindings,
  phone: string,
): Promise<{ farmer: FarmerRow; created: boolean }> {
  if (!env.DB) {
    throw new Error("D1 DB binding missing");
  }

  await ensureFarmerTable(env);
  const now = Math.floor(Date.now() / 1000);

  let farmer = await env.DB.prepare(
    `
      SELECT id, phone, name, location, crops, onboarding_step, onboarding_completed
      FROM farmers
      WHERE id = ?1
      LIMIT 1
    `,
  )
    .bind(phone)
    .first<FarmerRow>();

  if (!farmer) {
    await env.DB.prepare(
      `
        INSERT INTO farmers (id, phone, onboarding_step, onboarding_completed, created_at, last_active)
        VALUES (?1, ?2, 'name', 0, ?3, ?3)
      `,
    )
      .bind(phone, phone, now)
      .run();

    farmer = await env.DB.prepare(
      `
        SELECT id, phone, name, location, crops, onboarding_step, onboarding_completed
        FROM farmers
        WHERE id = ?1
        LIMIT 1
      `,
    )
      .bind(phone)
      .first<FarmerRow>();

    if (!farmer) {
      throw new Error("Failed to create farmer row");
    }

    return { farmer, created: true };
  }

  await env.DB.prepare("UPDATE farmers SET last_active = ?2 WHERE id = ?1")
    .bind(phone, now)
    .run();

  return { farmer, created: false };
}

async function ensureDiagnosesTable(env: Bindings): Promise<void> {
  if (!env.DB) return;

  await env.DB.prepare(
    `
      CREATE TABLE IF NOT EXISTS diagnoses (
        id TEXT PRIMARY KEY,
        farmer_id TEXT,
        image_key TEXT,
        diagnosis TEXT,
        confidence TEXT,
        gemini_response TEXT,
        feedback_correct INTEGER,
        created_at INTEGER
      )
    `,
  ).run();
}

function getExtensionFromMimeType(mimeType: string): string {
  const cleaned = mimeType.toLowerCase();
  if (cleaned.includes("png")) return "png";
  if (cleaned.includes("webp")) return "webp";
  return "jpg";
}

async function saveDiagnosis(
  env: Bindings,
  row: DiagnosisRow,
): Promise<void> {
  if (!env.DB) return;

  await ensureDiagnosesTable(env);
  await env.DB.prepare(
    `
      INSERT INTO diagnoses (
        id, farmer_id, image_key, diagnosis, confidence, gemini_response, feedback_correct, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `,
  )
    .bind(
      row.id,
      row.farmer_id,
      row.image_key,
      row.diagnosis,
      row.confidence,
      row.gemini_response,
      row.feedback_correct,
      row.created_at,
    )
    .run();
}

async function handleOnboarding(
  env: Bindings,
  phone: string,
  text: string,
): Promise<string | null> {
  if (!env.DB) return null;

  const now = Math.floor(Date.now() / 1000);
  const { farmer, created } = await getOrCreateFarmer(env, phone);

  if (created) {
    return "Bun venit la AgroBot! Ca sa te ajut mai bine, cum te numesti?";
  }

  if ((farmer.onboarding_completed ?? 0) === 1) {
    return null;
  }

  const step = farmer.onboarding_step ?? "name";

  if (step === "name") {
    const name = text.trim();
    if (!name) return "Cum te numesti?";

    await env.DB.prepare(
      "UPDATE farmers SET name = ?2, onboarding_step = 'location', last_active = ?3 WHERE id = ?1",
    )
      .bind(phone, name, now)
      .run();

    return `Multumesc, ${name}! In ce localitate ai ferma?`;
  }

  if (step === "location") {
    const location = text.trim();
    if (!location) return "Spune-mi localitatea fermei tale.";

    await env.DB.prepare(
      "UPDATE farmers SET location = ?2, onboarding_step = 'crops', last_active = ?3 WHERE id = ?1",
    )
      .bind(phone, location, now)
      .run();

    return "Perfect. Ce culturi principale ai? (ex: grau, porumb, floarea-soarelui)";
  }

  if (step === "crops") {
    const crops = text.trim();
    if (!crops)
      return "Scrie-mi culturile principale ca sa finalizez profilul.";

    await env.DB.prepare(
      "UPDATE farmers SET crops = ?2, onboarding_step = 'done', onboarding_completed = 1, last_active = ?3 WHERE id = ?1",
    )
      .bind(phone, crops, now)
      .run();

    return [
      "Super, profilul tau e gata!",
      "Poti folosi comenzile:",
      "- ajutor",
      "- vreme <localitate>",
      "- preturi",
      "- apia",
    ].join("\n");
  }

  await env.DB.prepare(
    "UPDATE farmers SET onboarding_step = 'done', onboarding_completed = 1, last_active = ?2 WHERE id = ?1",
  )
    .bind(phone, now)
    .run();

  return null;
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
  const imageMediaId = firstMessage?.image?.id;
  const messageType = firstMessage?.type;

  if (from && messageType === "image" && imageMediaId) {
    try {
      const result = await diagnoseFromWhatsAppMedia(imageMediaId, c.env);
      const { farmer } = await getOrCreateFarmer(c.env, from);

      let imageKey = "";
      if (c.env.BUCKET) {
        const extension = getExtensionFromMimeType(result.mimeType);
        imageKey = `incoming/${from}/${Date.now()}-${imageMediaId}.${extension}`;
        await c.env.BUCKET.put(imageKey, result.mediaBytes, {
          httpMetadata: { contentType: result.mimeType },
        });
      }

      const weatherWindow = farmer.location
        ? await getWeatherTreatmentWindow(farmer.location)
        : null;

      const finalReply = weatherWindow
        ? `${result.diagnosisText}\n\n${weatherWindow}`
        : result.diagnosisText;

      await saveDiagnosis(c.env, {
        id: crypto.randomUUID(),
        farmer_id: from,
        image_key: imageKey,
        diagnosis: result.diagnosisSummary,
        confidence: result.confidence,
        gemini_response: result.rawModelText,
        feedback_correct: null,
        created_at: Math.floor(Date.now() / 1000),
      });

      console.log("[webhook] image diagnosis completed", {
        from,
        elapsedMs: result.elapsedMs,
        slowerThan15s: result.elapsedMs > 15000,
        uncertain: result.uncertain,
        hasWeatherWindow: Boolean(weatherWindow),
        savedToR2: imageKey.length > 0,
      });

      await sendWhatsAppText(c.env, from, finalReply);
      return c.text("OK");
    } catch (error) {
      console.error("[webhook] image diagnosis failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await sendWhatsAppText(
        c.env,
        from,
        "Nu pot identifica clar problema din poza. Trimite una mai apropiata sau incearca din nou in cateva minute.\n⚠️ Diagnostic orientativ. Confirma cu un agronom.",
      );
      return c.text("OK");
    }
  }

  if (from && text) {
    try {
      const onboardingReply = await handleOnboarding(c.env, from, text);
      if (onboardingReply !== null) {
        await sendWhatsAppText(c.env, from, onboardingReply);
        return c.text("OK");
      }

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
