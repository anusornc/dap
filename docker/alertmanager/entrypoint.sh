#!/usr/bin/env sh
# Alertmanager entrypoint: expand env vars in config before starting
set -e

# Substitute ${VAR} patterns in alertmanager.yml
envsubst < /etc/alertmanager/alertmanager.yml.template > /etc/alertmanager/alertmanager.yml

# Start alertmanager (pass through any arguments)
exec prometheus-alertmanager "$@"