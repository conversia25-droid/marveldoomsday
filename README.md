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

## PWA

O app ja vem com manifest, icones e service worker. Em HTTPS, como no dominio do EasyPanel, o navegador pode oferecer instalacao como aplicativo.

- No Chrome/Android/desktop, o botao **Instalar** aparece dentro do app quando o navegador liberar.
- No iPhone/iPad, use **Compartilhar -> Adicionar a Tela de Inicio**.
- O cache offline cobre a tela principal, manifest, icones, `config.js` e `posters.json`. Login, sincronizacao e capas externas continuam dependendo de internet.

## Pagamento premium

O acesso vitalicio custa **R$9,90** e sera vendido somente por **Pix**. Para liberar automaticamente, o proximo passo e integrar Mercado Pago ou Asaas com webhook, gravando o usuario como premium no Supabase depois da confirmacao do pagamento.

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
- Usuarios logados podem editar nome, avatar, bio e deixar o perfil publico para recursos sociais futuros.
- O botao **Entrar sem conta** abre a rota em modo visitante e salva progresso só no navegador.

Para habilitar/atualizar perfis, rode `supabase/schema.sql` novamente. Ele adiciona campos em `profiles` e cria a RPC `update_own_profile`, que permite ao usuario editar só os campos seguros do proprio perfil, sem mexer em `role`.

O mesmo schema tambem cria o bucket publico `avatars` no Supabase Storage. Cada usuario autenticado so consegue enviar, atualizar ou apagar arquivos dentro da propria pasta, e o app aceita JPG, PNG, WEBP ou GIF ate 2 MB.

Se voce ja tinha rodado o schema antes e so precisa ativar o upload da foto de perfil, rode apenas `supabase/storage-avatar.sql` no SQL Editor do Supabase.

### Login com Google

No Supabase, va em **Authentication -> Sign In / Providers -> Google** e habilite o provider.

No Google Cloud, crie um OAuth Client do tipo **Web application**:

- **Authorized JavaScript origins**: a URL do seu site, e para teste local `http://127.0.0.1:8765`
- **Authorized redirect URIs**: a callback do Supabase, normalmente `https://keqvvdbaninwqwktwuyi.supabase.co/auth/v1/callback`

Depois cole o **Client ID** e **Client Secret** no provider Google do Supabase.

Em **Authentication -> URL Configuration**, coloque a URL final do site em **Site URL** e adicione tambem a URL local em **Redirect URLs** se for testar no navegador local.

Se o Google voltar para `http://localhost:3000`, troque o **Site URL** no Supabase para a URL real do app. Em desenvolvimento, adicione exatamente a URL local que voce usa, por exemplo `http://localhost:3000` ou `http://127.0.0.1:8765`.

O app usa PKCE e limpa automaticamente `#access_token...` ou `?code=...` da barra depois que a sessao e criada.

No fluxo PKCE, ver `?code=...` por alguns segundos e normal. Se ele ficar parado na barra, a URL provavelmente nao esta servindo o app ou nao esta liberada nos redirects do Supabase.

### Variaveis no EasyPanel

Para o TMDB, variaveis do EasyPanel ficam no container/nginx, nao no navegador. Para usar o token sem expor, use uma destas rotas:

1. Gere `posters.json` antes do deploy e publique só o JSON pronto.
2. Crie um endpoint/proxy no servidor que leia `TMDB_TOKEN` e consulte o TMDB por tras.

Injetar `TMDB_TOKEN` no HTML funciona, mas deixa a chave publica.
