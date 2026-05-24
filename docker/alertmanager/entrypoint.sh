#!/usr/bin/env sh
# Alertmanager entrypoint: expand env vars in config before starting
set -e

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\/&|\\]/\\&/g'
}

render_template() {
  sed \
    -e "s|\${SMTP_HOST}|$(escape_sed_replacement "${SMTP_HOST:-smtp.example.com}")|g" \
    -e "s|\${SMTP_PORT}|$(escape_sed_replacement "${SMTP_PORT:-587}")|g" \
    -e "s|\${SMTP_USER}|$(escape_sed_replacement "${SMTP_USER:-alerts@example.com}")|g" \
    -e "s|\${SMTP_PASSWORD}|$(escape_sed_replacement "${SMTP_PASSWORD:-}")|g" \
    -e "s|\${ALERT_EMAIL_TO}|$(escape_sed_replacement "${ALERT_EMAIL_TO:-admin@example.com}")|g" \
    -e "s|\${SLACK_WEBHOOK_URL}|$(escape_sed_replacement "${SLACK_WEBHOOK_URL:-https://example.invalid/slack-webhook}")|g" \
    /etc/alertmanager/alertmanager.yml.template
}

render_template > /tmp/alertmanager.yml

# Start alertmanager (pass through any arguments)
exec /bin/alertmanager "$@"
