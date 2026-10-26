export type PublishInput = {
  text: string;
  imageUrl?: string;
  /** Link da oferta, para botão clicável quando a plataforma suportar. */
  link?: string;
};

export interface Publisher {
  readonly name: string;
  /** Publica e retorna o id da mensagem. */
  publish(input: PublishInput): Promise<string>;
}
