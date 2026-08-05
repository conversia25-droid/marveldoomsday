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

Tambem da para atualizar tudo de novo quando o TMDB trocar uma capa:

    node generate-posters.mjs --refresh

Quando a lista oficial estiver no Supabase:

    $env:SUPABASE_URL="https://keqvvdbaninwqwktwuyi.supabase.co"
    $env:SUPABASE_ANON_KEY="sua_anon_key"
    node generate-posters.mjs --from-supabase --refresh

### Atualizacao automatica no GitHub

Crie os secrets `TMDB_TOKEN`, `SUPABASE_URL` e `SUPABASE_ANON_KEY`. O workflow `.github/workflows/update-posters.yml` roda toda segunda-feira e tambem pode ser acionado manualmente em **Actions -> Update TMDB posters -> Run workflow**.

## Supabase

O app pode usar Supabase para carregar a rota, manter a ordem dos filmes e salvar progresso por login.

1. No Supabase, abra **SQL Editor** e rode `supabase/schema.sql`
2. Depois rode `supabase/seed.sql`
3. Em **Authentication**, habilite login por email/senha
4. Crie uma conta pelo app
5. No SQL Editor, transforme seu usuario em admin:

       update public.profiles
       set role = 'admin'
       where email = 'seu-email@dominio.com';

No EasyPanel, configure estas variaveis:

    SUPABASE_URL=https://keqvvdbaninwqwktwuyi.supabase.co
    SUPABASE_ANON_KEY=sua_anon_key

Tambem aceito estes nomes, caso voce prefira copiar do ambiente Next:

    NEXT_PUBLIC_SUPABASE_URL=...
    NEXT_PUBLIC_SUPABASE_ANON_KEY=...

O `anon key` fica publico no navegador; isso e esperado no Supabase. Nao use `service_role` no frontend.

Fluxo no app:

- A primeira tela pede login por email/senha.
- O botao **Entrar com Google** usa o provider Google do Supabase.
- Ao entrar, o progresso local e enviado para `watch_progress`.
- Depois disso, cada item marcado/desmarcado e salvo no Supabase.
- O botao **Entrar sem conta** abre a rota em modo visitante e salva progresso só no navegador.

### Login com Google

No Supabase, va em **Authentication -> Sign In / Providers -> Google** e habilite o provider.

No Google Cloud, crie um OAuth Client do tipo **Web application**:

- **Authorized JavaScript origins**: a URL do seu site, e para teste local `http://127.0.0.1:8765`
- **Authorized redirect URIs**: a callback do Supabase, normalmente `https://keqvvdbaninwqwktwuyi.supabase.co/auth/v1/callback`

Depois cole o **Client ID** e **Client Secret** no provider Google do Supabase.

Em **Authentication -> URL Configuration**, coloque a URL final do site em **Site URL** e adicione tambem a URL local em **Redirect URLs** se for testar no navegador local.

Se o Google voltar para `http://localhost:3000`, troque o **Site URL** no Supabase para a URL real do app. Em desenvolvimento, adicione exatamente a URL local que voce usa, por exemplo `http://localhost:3000` ou `http://127.0.0.1:8765`.

O app usa PKCE e limpa automaticamente `#access_token...` ou `?code=...` da barra depois que a sessao e criada.

### Variaveis no EasyPanel

Para o TMDB, variaveis do EasyPanel ficam no container/nginx, nao no navegador. Para usar o token sem expor, use uma destas rotas:

1. Gere `posters.json` antes do deploy e publique só o JSON pronto.
2. Crie um endpoint/proxy no servidor que leia `TMDB_TOKEN` e consulte o TMDB por tras.

Injetar `TMDB_TOKEN` no HTML funciona, mas deixa a chave publica.
