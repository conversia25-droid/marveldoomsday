# Rota Doomsday

Checklist da maratona Marvel até Vingadores: Doomsday (18/12/2026).

## Deploy no EasyPanel

1. Suba estes arquivos para um repositório no GitHub
2. No EasyPanel: **New → App**
3. Aba **Source**: escolha GitHub e aponte para o repositório
4. Aba **Build**: selecione **Dockerfile** (não Nixpacks)
5. Aba **Domains**: adicione seu domínio, porta **80**, e ative HTTPS
6. Clique em **Deploy**

## Rodar localmente

    docker build -t rota-doomsday .
    docker run -p 8080:80 rota-doomsday

Acesse http://localhost:8080

## Gerar capas com TMDB

Use o **Token de Leitura da API** do TMDB como variavel de ambiente. Nao coloque o token no `index.html` antes de publicar.

    $env:TMDB_TOKEN="seu_token_v4"
    node generate-posters.mjs

O script atualiza `posters.json`, e o site carrega esse arquivo automaticamente.

### Variaveis no EasyPanel

Em site estatico, variaveis do EasyPanel ficam no container/nginx, nao no navegador. Para usar o token sem expor, use uma destas rotas:

1. Gere `posters.json` antes do deploy e publique só o JSON pronto.
2. Crie um endpoint/proxy no servidor que leia `TMDB_TOKEN` e consulte o TMDB por tras.

Injetar `TMDB_TOKEN` no HTML funciona, mas deixa a chave publica.
