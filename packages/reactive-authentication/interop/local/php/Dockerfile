# PHP Solid Server (pdsinterop/php-solid-server) at its last main commit e8d265c (2022-06-15), built with the
# repository's own Dockerfile steps. One adaptation: its php:7.3-apache base is Debian 11 (bullseye), whose
# packages moved to archive.debian.org after end of life, so the upstream `apt-get update` now fails with 404s.
FROM php:7.3-apache@sha256:b9872cd287ef72bc17d45d713aa2742f3d3bcf2503fea2506fd93aa94995219f

COPY --from=composer:2@sha256:9715c7f69044da2a212a5fbde29ee7da24e364d426560ae6367b060236f847d7 /usr/bin/composer /usr/local/bin/composer

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN echo 'deb http://archive.debian.org/debian bullseye main' > /etc/apt/sources.list \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install -y --no-install-recommends git libzip-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install bcmath mbstring mysqli pdo pdo_mysql zip
RUN a2enmod headers rewrite ssl

WORKDIR /app
RUN git clone https://github.com/pdsinterop/php-solid-server.git /app \
    && git checkout e8d265cd45c59ef0f02146ad44d52dc5a9cf71f0 \
    && cp site.conf /etc/apache2/sites-enabled/site.conf \
    && composer install --no-dev --prefer-dist \
    && chown -R www-data:www-data /app

# TLS certificate and key are mounted at /tls by interop/local/compose.yml (the harness's disposable test CA).
EXPOSE 443
