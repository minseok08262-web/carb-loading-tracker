import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.131.0";

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          carbs_g: { type: "number" },
        },
        required: ["name", "carbs_g"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["items", "note"],
  additionalProperties: false,
};

const PROMPT = `너는 마라톤 카보로딩 중인 러너의 식사 기록을 돕는 영양 보조야.
사진과 설명을 보고 음식별 탄수화물(g)을 추정해.
- 한국 음식은 한국 식당의 일반적인 1인분 양을 기준으로 하고, 사진의 그릇 크기와 남긴 양을 반영해.
- 설명이 사진과 다르면 설명을 우선해.
- 탄수화물이 거의 없는 반찬은 0에 가깝게 두되 목록에는 포함해.
- note에는 양을 어떻게 가정했는지 한국어 한 문장으로 적어.`;

// 긴 변이 1024px를 넘지 않게 줄여 JPEG base64로 만든다.
export async function imageToBase64(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

export async function estimateCarbs({ apiKey, imageBase64, description }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const content = [];
  if (imageBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } });
  }
  content.push({ type: "text", text: description ? `설명: ${description}` : "사진 속 음식의 탄수화물을 추정해 줘." });

  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: PROMPT,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("API 키가 올바르지 않아요. 설정에서 다시 확인해 주세요.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("요청이 많아요. 잠시 후 다시 시도해 주세요.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("인터넷 연결을 확인해 주세요.");
    if (err instanceof Anthropic.APIError) throw new Error(`추정에 실패했어요 (${err.status ?? "오류"}). 직접 입력을 이용해 주세요.`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new Error("이 사진은 추정할 수 없어요. 직접 입력을 이용해 주세요.");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("결과를 받지 못했어요. 다시 시도해 주세요.");
  return JSON.parse(text);
}
