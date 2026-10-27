import { z } from "zod";
import { sleep } from "../../util/concurrency.js";
import type { TikTokAuth } from "./auth.js";

const API = "https://open.tiktokapis.com/v2";

const creatorInfoSchema = z.object({
  data: z.object({
    creator_username: z.string().optional(),
    creator_nickname: z.string().optional(),
    creator_avatar_url: z.string().optional(),
    privacy_level_options: z.array(z.string()),
    comment_disabled: z.boolean().optional(),
    duet_disabled: z.boolean().optional(),
    stitch_disabled: z.boolean().optional(),
    max_video_post_duration_sec: z.number().optional(),
  }),
  error: z.object({ code: z.string(), message: z.string() }),
});

const initSchema = z.object({
  data: z.object({ publish_id: z.string(), upload_url: z.string() }).partial(),
  error: z.object({ code: z.string(), message: z.string() }),
});

const statusSchema = z.object({
  data: z.object({ status: z.string(), fail_reason: z.string().optional(), publicaly_available_post_id: z.array(z.union([z.string(), z.number()])).optional() }).partial(),
  error: z.object({ code: z.string(), message: z.string() }),
});

export type PrivacyLevel = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

/** Opções do post, espelhando as escolhas que a UX do TikTok exige mostrar ao criador. */
export type PostOptions = {
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  /** Conteúdo comercial: promove a própria marca ("Your brand"). */
  brandOrganic?: boolean;
  /** Conteúdo comercial: parceria paga ("Branded content"); não pode ser SELF_ONLY. */
  brandContent?: boolean;
  /** Chamado a cada checagem de status (para mostrar progresso). */
  onStatus?: (status: string) => void;
};

/** Publicação direta de vídeo via Content Posting API (Direct Post, FILE_UPLOAD). */
export class TikTokPublisher {
  readonly name = "tiktok";

  constructor(
    private readonly auth: TikTokAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<S extends z.ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    const token = await this.auth.getAccessToken();
    const response = await this.fetchImpl(`${API}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { error?: { code?: string; message?: string; log_id?: string } };
    if (json.error?.code !== "ok") {
      throw new Error(
        `TikTok ${path} (HTTP ${response.status}): ${json.error?.code ?? "sem código"} ${json.error?.message ?? JSON.stringify(json)}`,
      );
    }
    return schema.parse(json) as z.infer<S>;
  }

  async creatorInfo(): Promise<z.infer<typeof creatorInfoSchema>["data"]> {
    return (await this.post("/post/publish/creator_info/query/", {}, creatorInfoSchema)).data;
  }

  /**
   * Publica um vídeo e espera o processamento. Apps não auditados só podem usar SELF_ONLY.
   * Retorna o publish_id.
   */
  async publishVideo(video: Buffer, title: string, privacy: PrivacyLevel = "SELF_ONLY", options: PostOptions = {}): Promise<string> {
    if (options.brandContent && privacy === "SELF_ONLY") {
      throw new Error("Conteúdo de marca (branded content) não pode ser publicado como SELF_ONLY.");
    }
    const init = await this.post(
      "/post/publish/video/init/",
      {
        post_info: {
          title: title.slice(0, 2200),
          privacy_level: privacy,
          disable_duet: options.disableDuet ?? false,
          disable_comment: options.disableComment ?? false,
          disable_stitch: options.disableStitch ?? false,
          video_cover_timestamp_ms: 1000,
          brand_content_toggle: options.brandContent ?? false,
          brand_organic_toggle: options.brandOrganic ?? false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: video.length,
          chunk_size: video.length,
          total_chunk_count: 1,
        },
      },
      initSchema,
    );
    const { publish_id: publishId, upload_url: uploadUrl } = init.data;
    if (!publishId || !uploadUrl) {
      throw new Error("TikTok init não retornou publish_id/upload_url");
    }

    const upload = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "video/mp4",
        "content-length": String(video.length),
        "content-range": `bytes 0-${video.length - 1}/${video.length}`,
      },
      body: new Uint8Array(video),
    });
    if (!upload.ok) {
      throw new Error(`TikTok upload falhou (${upload.status}): ${await upload.text()}`);
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(3000);
      const status = await this.post("/post/publish/status/fetch/", { publish_id: publishId }, statusSchema);
      options.onStatus?.(status.data.status ?? "?");
      if (status.data.status === "PUBLISH_COMPLETE") {
        return publishId;
      }
      if (status.data.status === "FAILED") {
        throw new Error(`TikTok publicação falhou: ${status.data.fail_reason ?? "sem motivo"}`);
      }
    }
    throw new Error(`TikTok: publicação ${publishId} ainda processando após 90s`);
  }
}
