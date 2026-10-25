export type PublishInput = {
  text: string;
  imageUrl?: string;
};

export interface Publisher {
  readonly name: string;
  /** Publica e retorna o id da mensagem. */
  publish(input: PublishInput): Promise<string>;
}
