# Bot de ofertas (Telegram + Shopee)

Bot que busca ofertas na Shopee (API oficial de afiliados), filtra as boas e publica num canal do Telegram com link de afiliado.

**Status:** coleta, filtro, histórico, dedupe, Telegram e agendador prontos. Fonte padrão: Shopee. Falta configurar o Telegram no `.env` e escolher onde hospedar.

### Por que Shopee e não Mercado Livre

- A Shopee tem API oficial de afiliados: devolve as ofertas e o link de afiliado pronto (`offerLink`).
- O ML não tem API de afiliados e os termos proíbem montar/editar links. A fonte ML continua no código (`OFFER_SOURCE=mercadolivre`), mas só roda em dry-run.

## Como funciona

A cada execução (padrão: a cada 30 min, das 8h às 23h, horário de Brasília):

1. **Coleta** os mais vendidos de cada termo em `searchTerms` (Shopee). No ML, também os mais vendidos de `highlightCategoryIds`.
2. **Grava o preço** no histórico (SQLite), inclusive em dry-run.
3. **Filtra**: palavras bloqueadas, preço mínimo, vendedor (Shopee Mall/Indicado; no ML, loja oficial ou `5_green`), nota ≥ `minRating`, vendas ≥ `minSales`, comissão ≥ `minCommissionRate` (Shopee; 7% por padrão, pois metade dos produtos paga só 3%) e desconto:
   - com ≥ `minHistoryDays` dias de histórico: ≥ 15% abaixo da mediana de 30 dias;
   - sem isso: ≥ 25% de desconto da loja (`original_price`).
4. **Deduplica**: não repete produto em 7 dias, salvo queda adicional de 5%; o mesmo produto vindo de lojas diferentes aparece uma vez só.
5. **Publica** no canal a partir da fila da última coleta: um laço a cada minuto posta o próximo item quando o intervalo sorteado (entre `minIntervalMinutesBetweenPosts` e `maxIntervalMinutesBetweenPosts`, hoje 1–5 min) passou, até `maxPostsPerDay` (200). O ranking mistura desconto e comissão: `commissionWeight` 0 = só desconto, 1 = só comissão (comissão de 20% ou mais conta como nota máxima).
6. **Relata** cada rodada em `TELEGRAM_ADMIN_CHAT_ID` ("✅ Rotina ok 20:40 · 1661 produtos · 346 aprovadas · 12 novas · site: atualizado (300) · canal: ..."), mesmo com 0 novas; falhas viram alerta ⚠️ e a próxima execução segue.
7. **Site**: a cada rodada regrava `data/offers.json` no clone de `SITE_DIR` e faz push só se a lista mudou (GitHub Pages limita ~10 builds/hora). Os termos de busca viram categorias do site via `categories` em `config/filtros.json`.

## Setup

```bash
cp .env.example .env   # preencha
npm install
npm test
npm run dry-run        # mostra as ofertas que seriam publicadas
```

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm run dry-run` | Uma execução sem publicar (imprime as mensagens) |
| `npm start` | Agendador; publica se `DRY_RUN=false` |
| (automático) | `DRAFTS_CRON` (padrão 07:30) gera `DRAFTS_PER_RUN` rascunhos por dia e manda no Telegram do admin |
| `npm run draft` | Gera, por oferta, 2 slides 1080x1920, legenda e um vídeo de ~15 s com narração (Edge TTS pt-BR por padrão, `TTS_ENGINE`; `pip install edge-tts` no `.venv`) em `data/drafts/`, e manda para `TELEGRAM_ADMIN_CHAT_ID`, para postar manualmente no TikTok/Instagram |
| `npm run tiktok:post -- --gap=20 --privacy=SELF_ONLY <pasta-rascunho>...` | Publica rascunhos no TikTok com intervalo entre eles (app não auditado só aceita SELF_ONLY/FOLLOWER_OF_CREATOR) |
| `npm run logo` | Gera o logo da marca em `data/brand/` (foto de perfil para Telegram/TikTok/Pinterest, favicon do site) |
| `npm test` | Testes (vitest) |
| `npm run typecheck` / `npm run lint` | Checagens |
| `npm run build` | Compila para `dist/` |


## Rodando na nuvem (GitHub Actions)

O repositório público `achadinhosshoppeab-creator/bot-ofertas` (público para ter minutos ilimitados de Actions; segredos só na aba Secrets) tem dois workflows:

- `bot.yml`: roda 24h `npm run ci`: coleta → site → relatório → posts no canal (intervalo sorteado) → poda do histórico. Dia (8h–23h BRT): rodada a cada 10 min, janela de 20 min, posts a cada 1–5 min. Madrugada: rodada a cada 30 min, janela de 30 min, posts a cada 10–20 min (`PUBLISH_INTERVAL_MIN/MAX`). A janela é maior que o cron, então as rodadas se encadeiam sem buraco. O banco SQLite vive no cache do Actions (`bot-db-*`); `data/seed/state.json` (publicados + vistos) é commitado a cada rodada e semeia o banco se o cache sumir.
- `drafts.yml`: 07:30 BRT gera `DRAFTS_PER_RUN` vídeos (ffmpeg + edge-tts) e manda no Telegram do admin; também ficam como artefato por 7 dias.

Segredos: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_ADMIN_CHAT_ID`, `SHOPEE_APP_ID`, `SHOPEE_SECRET`, `SITE_DEPLOY_KEY` (chave SSH com escrita no repo do site). Não rode o bot local (`npm start`) junto com o Actions, senão o canal recebe posts em dobro.

## O que você precisa configurar fora do código

1. Criar bot no BotFather → `TELEGRAM_BOT_TOKEN`
2. Criar canal, adicionar o bot como admin → `TELEGRAM_CHANNEL_ID` (ex.: `@meucanal` ou `-100…`)
3. Seu chat privado para alertas → `TELEGRAM_ADMIN_CHAT_ID` (mande uma mensagem ao bot e veja `https://api.telegram.org/bot<TOKEN>/getUpdates`)
4. Shopee Afiliados → Open API → `SHOPEE_APP_ID` / `SHOPEE_SECRET` (feito). Cadastre o canal do Telegram como canal de divulgação no programa.
5. Rodar com `DRY_RUN=true` uns dias para formar histórico e calibrar `config/filtros.json`; depois `DRY_RUN=false`.

> Os descontos "da loja" na Shopee costumam ser inflados (ex.: "74% off"). Por isso o histórico importa: depois de `minHistoryDays` dias, o bot passa a comparar com a mediana real de preços.

## Página de ofertas (GitHub Pages)

- Repositório: `../achadinhosshoppeab-creator.github.io` → https://achadinhosshoppeab-creator.github.io
- A cada execução o bot grava `data/offers.json` com as melhores ofertas (`SITE_MAX_OFFERS`) e faz commit + push; o GitHub Pages publica sozinho. Isso acontece mesmo em `DRY_RUN=true` (desligue com `SITE_PUSH=false`).
- A página também hospeda `privacidade.html` e `termos.html`, exigidos pelas auditorias do TikTok e do Pinterest.
- É o destino do "link na bio".

## Divulgação (TikTok / Pinterest)

- As APIs de publicação do TikTok e do Pinterest só publicam em modo **privado** até o app passar por auditoria (TikTok: 2–6 semanas; Pinterest: acesso Standard). As duas exigem site + política de privacidade.
- Enquanto isso, `npm run draft` gera o carrossel e a legenda prontos; o post no TikTok é manual (link da bio → canal do Telegram).
- `BRAND_NAME` e `DRAFTS_PER_RUN` no `.env` controlam marca e quantidade.
- Vídeo: ffmpeg (zoom lento na foto + slide de chamada). Narração em português com o modelo Kokoro (`TTS_MODEL_DIR`, roda local via `.venv/bin/python tools/tts.py`). Sem `TTS_MODEL_DIR`, o vídeo sai mudo. Música: adicione no próprio TikTok.
- Setup da voz: `python3 -m venv .venv && .venv/bin/pip install sherpa-onnx soundfile numpy` e `brew install ffmpeg`.

## Rodando 24h

O processo precisa ficar ligado. Opções simples:

- **VPS/servidor** com [pm2](https://pm2.keymetrics.io/): `npm i -g pm2 && pm2 start npm --name bot-ofertas -- start && pm2 save && pm2 startup`
- **No próprio Mac**: `pm2` também funciona, mas só roda com o Mac ligado e acordado.

Guarde `data/bot.db` e `data/ml-tokens.json` entre deploys: são o histórico de preços e o token do ML.

## Estrutura

```
src/
  config.ts                 # .env + filtros.json (zod)
  db.ts                     # SQLite + migrações
  sources/shopee/           # cliente GraphQL assinado + fonte (padrão)
  sources/mercadolivre/     # auth (refresh token), cliente HTTP, fonte (só dry-run)
  affiliate/                # passthrough (Shopee) e link ML
  pipeline/                 # histórico/mediana, filtro, dedupe e limites
  publishers/               # formato da mensagem, Telegram, alertas
  content/                  # legendas/hashtags, carrossel (sharp) e vídeo (ffmpeg + TTS)
  site/                     # offers.json + git push para o GitHub Pages
tools/tts.py                # narração (Kokoro via sherpa-onnx)
  draft.ts                  # rascunhos para TikTok/Instagram (npm run draft)
  run.ts                    # uma execução (npm run dry-run)
  index.ts                  # agendador (npm start)
config/filtros.json
tests/
```
