import { z } from "zod";
import { escapeHtml } from "./format.js";
import type { PublishInput, Publisher } from "./types.js";

const responseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z.object({ message_id: z.number() }).optional(),
});

/** Cliente mínimo da Bot API do Telegram. */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call(method: string, body: Record<string, unknown>): Promise<number> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = responseSchema.parse(await response.json());
    if (!data.ok || !data.result) {
      throw new Error(`Telegram ${method} falhou: ${data.description ?? response.status}`);
    }
    return data.result.message_id;
  }

  sendMessage(chatId: string, text: string): Promise<number> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  }

  /** Envia um vídeo (arquivo local) com legenda. */
  async sendVideo(chatId: string, video: Buffer, caption: string): Promise<number> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", caption);
    form.set("video", new Blob([video], { type: "video/mp4" }), "video.mp4");
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendVideo`, { method: "POST", body: form });
    const data = responseSchema.parse(await response.json());
    if (!data.ok || !data.result) {
      throw new Error(`Telegram sendVideo falhou: ${data.description ?? response.status}`);
    }
    return data.result.message_id;
  }

  /** Envia várias imagens (arquivos locais) como álbum; a legenda vai na primeira. */
  async sendMediaGroup(chatId: string, images: Buffer[], caption: string): Promise<number> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set(
      "media",
      JSON.stringify(
        images.map((_, index) => ({
          type: "photo",
          media: `attach://img${index}`,
          ...(index === 0 ? { caption } : {}),
        })),
      ),
    );
    images.forEach((image, index) => form.set(`img${index}`, new Blob([image], { type: "image/jpeg" }), `slide${index + 1}.jpg`));

    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMediaGroup`, {
      method: "POST",
      body: form,
    });
    const data = z
      .object({ ok: z.boolean(), description: z.string().optional(), result: z.array(z.object({ message_id: z.number() })).optional() })
      .parse(await response.json());
    if (!data.ok || !data.result?.[0]) {
      throw new Error(`Telegram sendMediaGroup falhou: ${data.description ?? response.status}`);
    }
    return data.result[0].message_id;
  }

  sendPhoto(chatId: string, photo: string, caption: string): Promise<number> {
    return this.call("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML" });
  }
}

export class TelegramPublisher implements Publisher {
  readonly name = "telegram";

  constructor(
    private readonly client: TelegramClient,
    private readonly channelId: string,
  ) {}

  async publish(input: PublishInput): Promise<string> {
    if (input.imageUrl) {
      try {
        return String(await this.client.sendPhoto(this.channelId, input.imageUrl, input.text));
      } catch (error) {
        // Imagem inválida/inacessível não deve impedir o post.
        console.warn(`[telegram] sendPhoto falhou, enviando só texto: ${String(error)}`);
      }
    }
    return String(await this.client.sendMessage(this.channelId, input.text));
  }
}

/** Envia alertas para o chat privado do admin; sem chat configurado, só loga. */
export class TelegramAlerter {
  constructor(
    private readonly client: TelegramClient | undefined,
    private readonly adminChatId: string,
  ) {}

  async alert(message: string): Promise<void> {
    console.error(`[alerta] ${message}`);
    if (!this.client || !this.adminChatId) {
      return;
    }
    try {
      await this.client.sendMessage(this.adminChatId, `⚠️ bot-ofertas\n\n${escapeHtml(message.slice(0, 3500))}`);
    } catch (error) {
      console.error(`[alerta] não consegui avisar no Telegram: ${String(error)}`);
    }
  }
}
