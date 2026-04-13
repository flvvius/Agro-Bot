type DiagnosisEnv = {
  WHATSAPP_ACCESS_TOKEN: string;
  GEMINI_API_KEY: string;
};

export type DiagnosisResult = {
  diagnosisText: string;
  rawModelText: string;
  mimeType: string;
  mediaBytes: Uint8Array;
  confidence: "scazut" | "mediu" | "ridicat" | "necunoscut";
  uncertain: boolean;
  elapsedMs: number;
};

const DIAGNOSIS_PROMPT = [
  "Esti un agronom expert in boli si daunatori ai culturilor din Romania.",
  "Analizeaza fotografia plantei si raspunde concis in romana cu:",
  "1) Diagnostic probabil",
  "2) Nivel incredere (scazut/mediu/ridicat)",
  "3) Tratament recomandat (substanta activa + doza orientativa)",
  "4) Moment optim de aplicare",
  "Daca nu poti identifica clar, spune ca diagnosticul este incert.",
  "Incheie cu: ⚠️ Diagnostic orientativ. Confirma cu un agronom.",
].join("\n");

const DISCLAIMER = "⚠️ Diagnostic orientativ. Confirma cu un agronom.";

function withTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(`Timeout after ${timeoutMs}ms`), timeoutMs);
  return controller.signal;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function downloadWhatsAppMedia(
  mediaId: string,
  env: DiagnosisEnv,
): Promise<{ mimeType: string; base64: string; bytes: Uint8Array }> {
  const mediaMetaResponse = await fetch(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    {
      signal: withTimeoutSignal(8000),
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      },
    },
  );

  if (!mediaMetaResponse.ok) {
    throw new Error(`Meta media metadata failed: ${mediaMetaResponse.status}`);
  }

  const mediaMeta = (await mediaMetaResponse.json()) as {
    url?: string;
    mime_type?: string;
  };

  if (!mediaMeta.url) {
    throw new Error("Meta media metadata missing url");
  }

  const downloadResponse = await fetch(mediaMeta.url, {
    signal: withTimeoutSignal(10000),
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
  });

  if (!downloadResponse.ok) {
    throw new Error(`Meta media download failed: ${downloadResponse.status}`);
  }

  const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
  return {
    mimeType: mediaMeta.mime_type ?? "image/jpeg",
    base64: bytesToBase64(bytes),
    bytes,
  };
}

async function callGemini(
  mimeType: string,
  imageBase64: string,
  env: DiagnosisEnv,
): Promise<string> {
  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const response = await fetch(geminiUrl, {
    method: "POST",
    signal: withTimeoutSignal(12000),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            {
              text: DIAGNOSIS_PROMPT,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("\n")
    .trim();
  if (!text) {
    return "Nu am putut genera un diagnostic clar din aceasta imagine. ⚠️ Diagnostic orientativ. Confirma cu un agronom.";
  }

  return text;
}

function extractConfidence(
  text: string,
): "scazut" | "mediu" | "ridicat" | "necunoscut" {
  const normalized = text.toLowerCase();
  if (normalized.includes("ridicat")) return "ridicat";
  if (normalized.includes("mediu")) return "mediu";
  if (normalized.includes("scazut") || normalized.includes("scăzut")) {
    return "scazut";
  }
  return "necunoscut";
}

function normalizeDiagnosisText(rawText: string): { text: string; uncertain: boolean } {
  const normalized = rawText.toLowerCase();
  const uncertain =
    normalized.includes("incert") ||
    normalized.includes("nu pot identifica") ||
    normalized.includes("nu pot determina") ||
    normalized.includes("neclar") ||
    normalized.includes("insuficient");

  if (uncertain) {
    return {
      text: `Nu pot identifica clar problema din poza. Trimite o fotografie mai apropiata, cu lumina buna si focus pe zona afectata.\n${DISCLAIMER}`,
      uncertain: true,
    };
  }

  const base = rawText.trim();
  if (!base.includes(DISCLAIMER)) {
    return { text: `${base}\n${DISCLAIMER}`, uncertain: false };
  }

  return { text: base, uncertain: false };
}

export async function diagnoseFromWhatsAppMedia(
  mediaId: string,
  env: DiagnosisEnv,
): Promise<DiagnosisResult> {
  const startedAt = Date.now();
  const media = await downloadWhatsAppMedia(mediaId, env);
  const rawModelText = await callGemini(media.mimeType, media.base64, env);
  const normalized = normalizeDiagnosisText(rawModelText);

  return {
    diagnosisText: normalized.text,
    rawModelText,
    mimeType: media.mimeType,
    mediaBytes: media.bytes,
    confidence: extractConfidence(rawModelText),
    uncertain: normalized.uncertain,
    elapsedMs: Date.now() - startedAt,
  };
}
