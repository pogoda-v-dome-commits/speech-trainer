// Сервер ИИ-разбора для «Говори.ясно» (Cloudflare Worker).
// Ключ Anthropic хранится здесь как секрет и никогда не попадает в браузер.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Общее впечатление, 2–3 предложения" },
    scores: {
      type: "object",
      properties: {
        clarity: { type: "integer", description: "Ясность мысли, 1–10" },
        structure: { type: "integer", description: "Структура, 1–10" },
        persuasiveness: { type: "integer", description: "Убедительность, 1–10" },
      },
      required: ["clarity", "structure", "persuasiveness"],
      additionalProperties: false,
    },
    strengths: { type: "array", items: { type: "string" }, description: "2–3 сильные стороны" },
    improvements: {
      type: "array",
      description: "2–4 конкретных улучшения",
      items: {
        type: "object",
        properties: {
          issue: { type: "string", description: "Что не так, с цитатой из речи" },
          fix: { type: "string", description: "Как сказать лучше — готовая формулировка" },
        },
        required: ["issue", "fix"],
        additionalProperties: false,
      },
    },
    better_version: { type: "string", description: "Улучшенная версия речи той же длины и в том же голосе" },
    phrases: { type: "array", items: { type: "string" }, description: "3 сильные фразы-заготовки для этой темы" },
  },
  required: ["summary", "scores", "strengths", "improvements", "better_version", "phrases"],
  additionalProperties: false,
};

const SYSTEM = `Ты — тренер по деловой коммуникации и публичным выступлениям. Пользователь тренируется говорить: получил случайную тему, подготовился и произнёс речь вслух. Тебе приходит автоматическая расшифровка — в ней нет пунктуации и могут быть ошибки распознавания; не придирайся к ним и не считай их ошибками говорящего.

Дай доброжелательный, но честный и конкретный разбор на русском языке. Опирайся на то, что человек реально сказал, цитируй его слова. Улучшенная версия должна звучать как живая устная речь этого же человека (не как статья), сохранять его мысли и укладываться в то же время выступления. Если речь пустая или не по теме — скажи об этом прямо и покажи, как можно было раскрыть тему.`;

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "Только POST" }, 405, cors);
    if (allowed.length && !allowed.includes(origin)) return json({ error: "Запрос с чужого сайта" }, 403, cors);

    // Не больше N разборов в минуту с одного адреса — защита бюджета
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "anon" });
      if (!success) return json({ error: "Слишком много запросов. Подождите минуту." }, 429, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "Неверный запрос" }, 400, cors); }
    const { topic = "", text = "", mode = "easy", seconds = 60, stats = {}, code = "" } = body || {};
    if (env.ACCESS_CODE && code !== env.ACCESS_CODE) return json({ error: "Неверный код доступа" }, 401, cors);
    if (typeof text !== "string" || text.trim().split(/\s+/).length < 5) return json({ error: "Слишком короткая речь для разбора" }, 400, cors);
    if (text.length > 8000 || String(topic).length > 400) return json({ error: "Слишком длинный текст" }, 400, cors);

    const user = `Тема: ${topic}
Режим: ${mode === "hard" ? "сложный (2 минуты)" : "простой (1 минута)"}
Длительность речи: ${Math.round(seconds)} сек
Автоматические замеры: темп ${stats.wpm ?? "?"} слов/мин, слов-паразитов ${stats.fillers ?? "?"}, слов всего ${stats.words ?? "?"}

Расшифровка речи:
"""
${text}
"""`;

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      });
      if (response.stop_reason === "refusal") return json({ error: "ИИ не смог разобрать эту речь. Попробуйте другую тему." }, 422, cors);
      const block = response.content.find((b) => b.type === "text");
      if (!block) return json({ error: "Пустой ответ ИИ" }, 502, cors);
      return json(JSON.parse(block.text), 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return json({ error: "ИИ перегружен, попробуйте через минуту" }, 429, cors);
      if (error instanceof Anthropic.AuthenticationError) return json({ error: "Ошибка ключа ИИ на сервере" }, 500, cors);
      if (error instanceof Anthropic.APIError) return json({ error: `Ошибка ИИ (${error.status})` }, 502, cors);
      if (error instanceof SyntaxError) return json({ error: "ИИ вернул неполный ответ, попробуйте ещё раз" }, 502, cors);
      return json({ error: "Сервер недоступен" }, 500, cors);
    }
  },
};
