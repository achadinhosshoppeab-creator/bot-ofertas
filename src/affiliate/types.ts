import type { Offer } from "../sources/types.js";

export interface AffiliateLinker {
  readonly name: string;
  /** Retorna URL com tracking de afiliado para a oferta. */
  buildLink(offer: Offer): Promise<string>;
}
