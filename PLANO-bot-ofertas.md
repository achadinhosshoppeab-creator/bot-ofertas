# Bot de ofertas de games e hardware (Telegram + afiliado)

Objetivo da primeira versão: um bot que busca ofertas de games e hardware no Mercado Livre, filtra as boas e publica num canal do Telegram com link de afiliado. Meta do teste: validar até a Black Friday (27/11/2026) se o canal ganha inscritos e gera vendas.

## Escopo da v1

Dentro:

- Uma fonte de ofertas: Mercado Livre.
- Um destino: canal no Telegram.
- Filtro por categoria, desconto mínimo e histórico de preço.
- Deduplicação (não repetir a mesma oferta).
- Execução agendada, sem intervenção manual.

Fora (só depois de validar):

- Amazon, Shopee, Awin.
- WhatsApp.
- Painel web, IA para legendas, múltiplos canais.

## Stack

- Node.js 20+ com TypeScript.
- SQLite (better-sqlite3) para histórico de preços e ofertas publicadas.
- Bot API do Telegram via `fetch` (sem grammY: só usamos sendPhoto/sendMessage) — etapa 7.
- node-cron para agendamento local — etapa 9.
- zod para validar configuração e respostas de API.
- vitest para testes.

## Progresso

| Etapa | Descrição | Status |
|-------|-----------|--------|
| 1 | Setup do projeto | Feito |
| 2 | Banco SQLite | Feito |
| 3 | Fonte Mercado Livre | Feito |
| 4 | Histórico de preços / mediana | Feito |
| 5 | Filtro e deduplicação | Feito |
| 6 | Link de afiliado | Feito (validar parâmetros com o portal) |
| 7 | Publicador Telegram | Feito |
| 8 | Orquestração (`run.ts`) | Feito |
| 9 | Agendamento | Feito |
| 10 | Modo dry-run | Feito |
| 11 | Deploy + alertas | Alertas feitos; deploy pendente |

## Mudança de fonte (out/2026): Shopee

- O afiliado do ML não tem API e os termos proíbem editar/montar links → não dá para automatizar 100%.
- Shopee: Open API de afiliados (GraphQL em `open-api.affiliate.shopee.com.br/graphql`, assinatura `SHA256(appId+timestamp+payload+secret)`).
  `productOfferV2` traz preço, `priceDiscountRate`, comissão, nota, vendas, `shopType` e `offerLink` (link de afiliado pronto). Não traz vídeo.
  `conversionReport` permite acompanhar vendas.
- Fonte padrão agora é `OFFER_SOURCE=shopee`; ML fica só para dry-run.

## Notas da API do Mercado Livre

- `/sites/MLB/search` responde 403 para apps comuns; não dá para usar.
- Coleta: `/products/search?q=` (termos) + `/highlights/MLB/category/{id}` (mais vendidos) → `/products/{id}/items` (anúncio novo mais barato, com `original_price`).
- Reputação: `/users/{seller_id}` → `seller_reputation.level_id`.
- O refresh token é de uso único; os tokens renovados ficam em `data/ml-tokens.json`.

## Modelo de dados

Tipo `Offer`:

- `source`, `productId`, `title`, `price`, `originalPrice`, `url`, `imageUrl`, `category`, `seller`, `fetchedAt`

Tabelas SQLite:

- `price_history(product_id, source, price, fetched_at)`
- `published(product_id, source, price, published_at, message_id)`

## Regras do filtro (`config/filtros.json`)

- Categorias/termos: console, jogos, controle, headset, SSD, monitor, placa de vídeo, periféricos.
- Desconto mínimo: 15% sobre a mediana dos últimos 30 dias.
- Sem histórico: desconto da loja com limite 25%.
- Preço mínimo: R$ 50.
- Vendedor: loja oficial ou reputação alta.
- Palavras bloqueadas: capa, película, usado, réplica, etc.
- Não republicar em menos de 7 dias, salvo queda adicional de 5%.
- Máximo 10 posts/dia, intervalo mínimo 30 minutos.

## Formato da mensagem no Telegram

```
🎮 {título curto}

De R$ {preço anterior} por R$ {preço atual} ({desconto}% off)
Menor preço em {N} dias

🛒 {link de afiliado}

Link de afiliado: o canal pode receber comissão.
```

Enviar com foto (`sendPhoto` + legenda).

## Restrições

- Apenas APIs/feeds oficiais; sem scraping HTML.
- Não copiar ofertas de outros canais.
- Toda mensagem com aviso de afiliado.
- Segredos só em `.env`.
- Fontes e afiliados atrás de interfaces (`OfferSource`, `AffiliateLinker`).

## Critérios de pronto da v1

- `npm run dry-run` lista ofertas filtradas sem publicar.
- `npm start` publica no canal respeitando limites e sem repetir oferta.
- Testes do filtro e da deduplicação passando.
- Falha em uma execução gera alerta e não derruba o processo.
