import type { Offer } from "../sources/types.js";
import type { AffiliateLinker } from "./types.js";

/** Para fontes cuja URL já vem como link de afiliado oficial (ex.: `offerLink` da Shopee). */
export class PassthroughLinker implements AffiliateLinker {
  readonly name = "passthrough";

  async buildLink(offer: Offer): Promise<string> {
    return offer.url;
  }
}
