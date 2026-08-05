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
