# Rota Doomsday — site estático servido por nginx
FROM nginx:alpine

# copia os arquivos do app para a pasta pública do nginx
COPY index.html /usr/share/nginx/html/
COPY config.js /usr/share/nginx/html/
COPY config.template.js /usr/share/nginx/html/
COPY manifest.webmanifest /usr/share/nginx/html/
COPY posters.json /usr/share/nginx/html/
COPY icon-192.png /usr/share/nginx/html/
COPY icon-512.png /usr/share/nginx/html/
COPY apple-touch-icon.png /usr/share/nginx/html/
COPY docker-entrypoint.d/99-render-config.sh /docker-entrypoint.d/99-render-config.sh

RUN chmod +x /docker-entrypoint.d/99-render-config.sh

# configuração enxuta com os tipos de conteúdo corretos
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
