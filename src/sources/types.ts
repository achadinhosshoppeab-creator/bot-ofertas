export type OfferSeller = {
  id?: string;
  name: string;
  /** Nível de reputação da fonte (no ML: `seller_reputation.level_id`, ex. "5_green"). */
  reputation?: string;
  powerSellerStatus?: string;
  officialStore?: boolean;
};

export type Offer = {
  source: string;
  productId: string;
  title: string;
  price: number;
  originalPrice?: number;
  url: string;
  imageUrl?: string;
  category?: string;
  /** Termo de busca que encontrou a oferta (vira categoria no site). */
  searchTerm?: string;
  seller?: OfferSeller;
  /** Nota média do produto (0–5). */
  rating?: number;
  salesCount?: number;
  /** Comissão de afiliado (fração, ex. 0.08 = 8%). */
  commissionRate?: number;
  /** O preço é o da variação mais barata ("a partir de"). */
  hasVariantPrices?: boolean;
  fetchedAt: Date;
};

export interface OfferSource {
  readonly name: string;
  search(terms: string[]): Promise<Offer[]>;
}
