type DiagnosisEnv = {
	WHATSAPP_ACCESS_TOKEN: string;
	GEMINI_API_KEY: string;
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
): Promise<{ mimeType: string; base64: string }> {
	const mediaMetaResponse = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
		headers: {
			Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
		},
	});

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
	};
}

async function callGemini(mimeType: string, imageBase64: string, env: DiagnosisEnv): Promise<string> {
	const geminiUrl =
		`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent` +
		`?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

	const response = await fetch(geminiUrl, {
		method: "POST",
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

	const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n").trim();
	if (!text) {
		return "Nu am putut genera un diagnostic clar din aceasta imagine. ⚠️ Diagnostic orientativ. Confirma cu un agronom.";
	}

	return text;
}

export async function diagnoseFromWhatsAppMedia(
	mediaId: string,
	env: DiagnosisEnv,
): Promise<string> {
	const media = await downloadWhatsAppMedia(mediaId, env);
	return callGemini(media.mimeType, media.base64, env);
}
