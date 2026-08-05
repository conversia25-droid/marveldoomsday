# Rota Doomsday — site estático servido por nginx
FROM nginx:alpine

# copia os arquivos do app para a pasta pública do nginx
COPY index.html /usr/share/nginx/html/
COPY manifest.webmanifest /usr/share/nginx/html/
COPY icon-192.png /usr/share/nginx/html/
COPY icon-512.png /usr/share/nginx/html/
COPY apple-touch-icon.png /usr/share/nginx/html/

# configuração enxuta com os tipos de conteúdo corretos
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
