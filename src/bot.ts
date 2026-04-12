import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createMemoryState } from "@chat-adapter/state-memory";
import { getWeatherForecast } from "./services/weather";
import { getBrmPrices } from "./services/prices";
import { getApiaDeadlines } from "./services/apia";

type WhatsAppBindings = {
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_VERIFY_TOKEN: string;
};

let cachedBot: Chat | null = null;
let cachedKey = "";

async function buildResponseText(text: string): Promise<string> {
  if (text === "ajutor") {
    return [
      "Comenzi disponibile:",
      "- ajutor",
      "- vreme <localitate>",
      "- preturi",
      "- apia",
    ].join("\n");
  }

  if (text.startsWith("vreme")) {
    const location = text.replace("vreme", "").trim();
    if (!location) {
      return "Spune-mi si localitatea. Exemplu: vreme Craiova";
    }

    return await getWeatherForecast(location);
  }

  if (text === "preturi") {
    return await getBrmPrices();
  }

  if (text === "apia") {
    return await getApiaDeadlines();
  }

  return "Salut! Sunt AgroBot. Trimite 'ajutor' pentru comenzi.";
}

function resolveRecipientId(thread: any, message: any): string | null {
  const fromMessage =
    message?.authorId ?? message?.userId ?? message?.from ?? message?.senderId;

  if (typeof fromMessage === "string" && fromMessage.length > 0) {
    return fromMessage;
  }

  const threadId = thread?.id;
  if (typeof threadId === "string") {
    const parts = threadId.split(":");
    const last = parts.at(-1);
    if (last) return last;
  }

  return null;
}

async function sendWhatsAppText(
  env: WhatsAppBindings,
  to: string,
  text: string,
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  console.log("[bot] outbound send attempt", {
    to,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    textPreview: text.slice(0, 60),
  });

  let response: Response;
  try {
    response = await fetch(url, {
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
  } catch (error) {
    console.error("[bot] outbound fetch threw", {
      to,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const body = await response.text();
  if (!response.ok) {
    console.error("[bot] outbound send failed", {
      status: response.status,
      body,
      to,
    });
    return;
  }

  console.log("[bot] outbound send ok", {
    status: response.status,
    to,
  });
}

async function handleIncomingText(
  env: WhatsAppBindings,
  thread: any,
  message: { text?: string | null },
) {
  const text = message.text?.toLowerCase().trim() ?? "";
  console.log("[bot] incoming message", { text });
  const recipientId = resolveRecipientId(thread, message);
  console.log("[bot] resolved recipient", {
    recipientId,
    threadId: thread?.id,
  });
  if (!recipientId) {
    console.error("[bot] could not resolve recipient id", {
      threadId: thread?.id,
    });
    return;
  }

  const responseText = await buildResponseText(text);
  await sendWhatsAppText(env, recipientId, responseText);
}

export function getBot(env: WhatsAppBindings): Chat {
  const cacheKey = [
    env.WHATSAPP_PHONE_NUMBER_ID,
    env.WHATSAPP_VERIFY_TOKEN,
    env.WHATSAPP_ACCESS_TOKEN,
    env.WHATSAPP_APP_SECRET,
  ].join("|");

  if (cachedBot && cachedKey === cacheKey) {
    return cachedBot;
  }

  const bot = new Chat({
    userName: "agrobot",
    adapters: {
      whatsapp: createWhatsAppAdapter({
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        appSecret: env.WHATSAPP_APP_SECRET,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      }),
    },
    state: createMemoryState(),
  });

  bot.onDirectMessage(async (thread, message) => {
    await handleIncomingText(env, thread, message);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await handleIncomingText(env, thread, message);
  });

  bot.onNewMention(async (thread, message) => {
    await handleIncomingText(env, thread, message);
  });

  cachedBot = bot;
  cachedKey = cacheKey;
  return bot;
}
