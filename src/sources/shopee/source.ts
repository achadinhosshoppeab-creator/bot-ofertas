import { z } from "zod";
import { mapLimit } from "../../util/concurrency.js";
import type { Offer, OfferSource } from "../types.js";
import type { ShopeeClient } from "./client.js";

const SOURCE_NAME = "shopee";
const CONCURRENCY = 2;
/** sortType da productOfferV2: 2 = mais vendidos. */
const SORT_BY_SALES = 2;
/** shopType: 1 = Shopee Mall (loja oficial), 2 = Indicado, 4 = Indicado Plus. */
const SHOP_MALL = 1;
const SHOP_PREFERRED = [2, 4];

const numeric = z.union([z.string(), z.number()]).transform((value) => Number(value));

const productOfferSchema = z.object({
  productOfferV2: z.object({
    nodes: z.array(
      z.object({
        itemId: z.union([z.number(), z.string()]).transform(String),
        productName: z.string(),
        price: numeric,
        priceMin: numeric.nullish(),
        priceMax: numeric.nullish(),
        priceDiscountRate: z.number().nullish(),
        commissionRate: numeric.nullish(),
        sales: z.number().nullish(),
        ratingStar: numeric.nullish(),
        imageUrl: z.string().nullish(),
        shopName: z.string().nullish(),
        shopId: z.union([z.number(), z.string()]).transform(String).nullish(),
        shopType: z.array(z.number()).nullish(),
        productCatIds: z.array(z.number()).nullish(),
        offerLink: z.string(),
      }),
    ),
  }),
});

type Node = z.infer<typeof productOfferSchema>["productOfferV2"]["nodes"][number];

export type ShopeeSourceOptions = {
  maxProductsPerTerm: number;
};

/** Fonte Shopee via Open API oficial de afiliados; `url` já é o link de afiliado. */
export class ShopeeSource implements OfferSource {
  readonly name = SOURCE_NAME;

  constructor(
    private readonly client: ShopeeClient,
    private readonly options: ShopeeSourceOptions,
  ) {}

  async search(terms: string[]): Promise<Offer[]> {
    const fetchedAt = new Date();
    const results = await mapLimit(terms, CONCURRENCY, async (term) => {
      try {
        const data = await this.client.query(
          `{ productOfferV2(keyword: ${JSON.stringify(term)}, sortType: ${SORT_BY_SALES}, page: 1, limit: ${this.options.maxProductsPerTerm}) {
              nodes { itemId productName price priceMin priceMax priceDiscountRate commissionRate sales ratingStar imageUrl shopName shopId shopType productCatIds offerLink }
            } }`,
          productOfferSchema,
        );
        return data.productOfferV2.nodes.map((node) => ({ ...toOffer(node, fetchedAt), searchTerm: term }));
      } catch (error) {
        console.warn(`[shopee] busca "${term}" falhou: ${String(error)}`);
        return [];
      }
    });
    return results.flat();
  }
}

export function toOffer(node: Node, fetchedAt: Date): Offer {
  const shopType = node.shopType ?? [];
  const discount = node.priceDiscountRate ?? 0;
  const originalPrice =
    discount > 0 && discount < 100 ? Math.round((node.price / (1 - discount / 100)) * 100) / 100 : undefined;
  const category = node.productCatIds?.at(-1);

  return {
    source: SOURCE_NAME,
    productId: node.itemId,
    title: node.productName,
    price: node.price,
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(node.priceMax != null && node.priceMax > node.price ? { hasVariantPrices: true } : {}),
    url: node.offerLink,
    ...(node.imageUrl ? { imageUrl: node.imageUrl } : {}),
    ...(category !== undefined ? { category: String(category) } : {}),
    seller: {
      ...(node.shopId ? { id: node.shopId } : {}),
      name: node.shopName ?? "",
      officialStore: shopType.includes(SHOP_MALL),
      ...(shopType.some((type) => SHOP_PREFERRED.includes(type)) ? { reputation: "shopee_preferred" } : {}),
    },
    ...(node.ratingStar != null && node.ratingStar > 0 ? { rating: node.ratingStar } : {}),
    ...(node.sales != null ? { salesCount: node.sales } : {}),
    ...(node.commissionRate != null ? { commissionRate: node.commissionRate } : {}),
    fetchedAt,
  };
}
