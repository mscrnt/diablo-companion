// Vision-LLM helpers for "learning" the UI layout: Qwen returns boxes in a
// 0–1000 normalised space (verified on this setup: ~1.7 s for a 2560×720 frame).
import { chatJson, imagePart } from "./llm";
import { useSettings } from "./store";

export interface NBox {
  x: number; // 0..1 of the captured image
  y: number;
  w: number;
  h: number;
}

export async function locateUi<K extends string>(
  imageB64: string,
  question: string,
  labels: K[],
): Promise<{ answer: boolean; boxes: Partial<Record<K, NBox>>; note: string }> {
  const { llm } = useSettings.getState().settings;
  const schema = {
    type: "object",
    properties: {
      answer: { type: "boolean" },
      note: { type: "string" },
      boxes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", enum: labels },
            bbox_2d: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
          },
          required: ["label", "bbox_2d"],
          additionalProperties: false,
        },
      },
    },
    required: ["answer", "note", "boxes"],
    additionalProperties: false,
  };
  const r = await chatJson<{ answer: boolean; note: string; boxes: { label: K; bbox_2d: number[] }[] }>(
    llm,
    [
      {
        role: "system",
        content:
          "You look at Diablo IV screenshots. Answer the question in `answer` (true/false) and give bounding boxes for the requested UI elements that are visible, as bbox_2d = [x1, y1, x2, y2] integers normalised to 0-1000 relative to the full image. Omit elements that are not visible. Keep `note` under 20 words.",
      },
      { role: "user", content: [imagePart(imageB64), { type: "text", text: `${question}\nElements: ${labels.join(", ")}` }] },
    ],
    { jsonSchema: { name: "ui_locate", schema }, maxTokens: 800, timeoutMs: 45000 },
  );
  const boxes: Partial<Record<K, NBox>> = {};
  for (const b of r.boxes ?? []) {
    const [x1, y1, x2, y2] = b.bbox_2d.map((v) => Math.max(0, Math.min(1000, v)) / 1000);
    if (x2 > x1 && y2 > y1) boxes[b.label] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  return { answer: !!r.answer, boxes, note: r.note ?? "" };
}
