import type { Offer } from "../sources/types.js";
import type { AffiliateLinker } from "./types.js";

/**
 * Link de afiliado do Mercado Livre no formato longo
 * (`matt_tool` = ID de afiliado, `matt_word` = etiqueta).
 * Confira com um link gerado no portal de afiliados se os parâmetros batem.
 */
export class MercadoLivreAffiliateLinker implements AffiliateLinker {
  readonly name = "mercadolivre";

  constructor(
    private readonly affiliateId: string,
    private readonly tag: string = "",
  ) {}

  async buildLink(offer: Offer): Promise<string> {
    const url = new URL(offer.url);
    if (this.affiliateId) {
      url.searchParams.set("matt_tool", this.affiliateId);
    }
    if (this.tag) {
      url.searchParams.set("matt_word", this.tag);
    }
    return url.toString();
  }
}
