import { Hono } from "hono";
import { getBot } from "./bot";

type Bindings = {
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_VERIFY_TOKEN: string;
  GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => c.text("AgroBot OK"));
app.get("/webhook", (c) =>
  getBot(c.env).webhooks.whatsapp(c.req.raw, {
    waitUntil: (task) => c.executionCtx.waitUntil(task),
  }),
);
app.post("/webhook", async (c) => {
  const request = c.req.raw;

  try {
    const payload = (await request.clone().json()) as {
      entry?: Array<{
        changes?: Array<{
          value?: { messages?: unknown[]; statuses?: unknown[] };
        }>;
      }>;
    };
    const value = payload.entry?.[0]?.changes?.[0]?.value;
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

  return getBot(c.env).webhooks.whatsapp(request, {
    waitUntil: (task) => c.executionCtx.waitUntil(task),
  });
});

export default app;
