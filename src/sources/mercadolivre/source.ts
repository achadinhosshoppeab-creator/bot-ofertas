import { z } from "zod";
import { mapLimit } from "../../util/concurrency.js";
import type { Offer, OfferSeller, OfferSource } from "../types.js";
import { MlHttpError, type MlClient } from "./client.js";

const SOURCE_NAME = "mercadolivre";
const CONCURRENCY = 4;

const pictureSchema = z.object({ url: z.string() });

const productSearchSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pictures: z.array(pictureSchema).nullish(),
    }),
  ),
});

const highlightsSchema = z.object({
  content: z.array(z.object({ id: z.string(), type: z.string() })),
});

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  pictures: z.array(pictureSchema).nullish(),
});

const productItemsSchema = z.object({
  results: z.array(
    z.object({
      item_id: z.string(),
      seller_id: z.number(),
      price: z.number(),
      original_price: z.number().nullish(),
      category_id: z.string().nullish(),
      condition: z.string().nullish(),
      official_store_id: z.number().nullish(),
    }),
  ),
});

const userSchema = z.object({
  nickname: z.string().nullish(),
  seller_reputation: z
    .object({
      level_id: z.string().nullish(),
      power_seller_status: z.string().nullish(),
    })
    .nullish(),
});

type ProductRef = { id: string; name?: string; imageUrl?: string };

export type MercadoLivreSourceOptions = {
  /** Categorias cujos mais vendidos (`/highlights`) entram na coleta. */
  highlightCategoryIds: string[];
  maxProductsPerTerm: number;
};

/**
 * Fonte Mercado Livre via API oficial.
 *
 * A busca de anúncios (`/sites/MLB/search`) é bloqueada para apps comuns, então
 * coletamos produtos de catálogo (busca por termo + mais vendidos por categoria)
 * e, para cada um, o anúncio novo mais barato em `/products/{id}/items`.
 */
export class MercadoLivreSource implements OfferSource {
  readonly name = SOURCE_NAME;
  private readonly sellers = new Map<number, Promise<OfferSeller>>();

  constructor(
    private readonly client: MlClient,
    private readonly options: MercadoLivreSourceOptions,
  ) {}

  async search(terms: string[]): Promise<Offer[]> {
    const refs = new Map<string, ProductRef>();

    const byTerm = await mapLimit(terms, CONCURRENCY, (term) =>
      this.searchProducts(term),
    );
    const byCategory = await mapLimit(
      this.options.highlightCategoryIds,
      CONCURRENCY,
      (categoryId) => this.highlightProducts(categoryId),
    );
    for (const ref of [...byTerm.flat(), ...byCategory.flat()]) {
      if (!refs.has(ref.id)) {
        refs.set(ref.id, ref);
      }
    }

    const offers = await mapLimit([...refs.values()], CONCURRENCY, (ref) =>
      this.toOffer(ref).catch((error: unknown) => {
        console.warn(`[ml] ignorando ${ref.id}: ${String(error)}`);
        return undefined;
      }),
    );
    return offers.filter((offer): offer is Offer => offer !== undefined);
  }

  private async searchProducts(term: string): Promise<ProductRef[]> {
    const query = new URLSearchParams({
      status: "active",
      site_id: "MLB",
      q: term,
      limit: String(this.options.maxProductsPerTerm),
    });
    const data = await this.client.get(
      `/products/search?${query}`,
      productSearchSchema,
    );
    return data.results.map((product) => ({
      id: product.id,
      name: product.name,
      ...withImage(product.pictures?.[0]?.url),
    }));
  }

  private async highlightProducts(categoryId: string): Promise<ProductRef[]> {
    const data = await this.client.get(
      `/highlights/MLB/category/${categoryId}`,
      highlightsSchema,
    );
    return data.content
      .filter((entry) => entry.type === "PRODUCT")
      .map((entry) => ({ id: entry.id }));
  }

  private async toOffer(ref: ProductRef): Promise<Offer | undefined> {
    let items: z.infer<typeof productItemsSchema>;
    try {
      items = await this.client.get(
        `/products/${ref.id}/items?limit=20`,
        productItemsSchema,
      );
    } catch (error) {
      // Produto de catálogo sem anúncio ativo ("No winners found").
      if (error instanceof MlHttpError && error.status === 404) {
        return undefined;
      }
      throw error;
    }

    const best = items.results
      .filter((item) => item.condition === "new")
      .sort((a, b) => a.price - b.price)[0];
    if (!best) {
      return undefined;
    }

    let { name, imageUrl } = ref;
    if (!name) {
      const product = await this.client.get(`/products/${ref.id}`, productSchema);
      name = product.name;
      imageUrl = product.pictures?.[0]?.url;
    }

    const seller = await this.getSeller(best.seller_id, best.official_store_id != null);

    return {
      source: SOURCE_NAME,
      productId: ref.id,
      title: name,
      price: best.price,
      ...(best.original_price != null && best.original_price > best.price
        ? { originalPrice: best.original_price }
        : {}),
      url: itemUrl(best.item_id),
      ...withImage(imageUrl),
      ...(best.category_id ? { category: best.category_id } : {}),
      seller,
      fetchedAt: new Date(),
    };
  }

  private getSeller(sellerId: number, officialStore: boolean): Promise<OfferSeller> {
    let seller = this.sellers.get(sellerId);
    if (!seller) {
      seller = this.client.get(`/users/${sellerId}`, userSchema).then((user) => {
        const level = user.seller_reputation?.level_id;
        const power = user.seller_reputation?.power_seller_status;
        return {
          id: String(sellerId),
          name: user.nickname ?? String(sellerId),
          ...(level ? { reputation: level } : {}),
          ...(power ? { powerSellerStatus: power } : {}),
        };
      });
      this.sellers.set(sellerId, seller);
    }
    return seller.then((s) => ({ ...s, officialStore }));
  }
}

/** `MLB4036053887` → `https://produto.mercadolivre.com.br/MLB-4036053887` */
export function itemUrl(itemId: string): string {
  return `https://produto.mercadolivre.com.br/${itemId.replace(/^([A-Z]+)(\d+)$/, "$1-$2")}`;
}

function withImage(url: string | undefined): { imageUrl?: string } {
  return url ? { imageUrl: url } : {};
}
