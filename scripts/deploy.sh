#!/usr/bin/env bash
# =============================================================================
# DAP Docker Deployment Script
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Script info
SCRIPT_NAME="$(basename "$0")"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${CYAN}${BOLD}============================================${NC}"
    echo -e "${CYAN}${BOLD}  DAP Docker Deployment Manager${NC}"
    echo -e "${CYAN}${BOLD}============================================${NC}"
    echo ""
}

show_urls() {
    echo ""
    echo -e "${BOLD}Service URLs:${NC}"
    echo -e "  DAP Relay:        http://localhost:3000"
    echo -e "  DAP Relay (TLS):  https://localhost:3443"
    echo -e "  Prometheus:       http://localhost:9090"
    echo -e "  Grafana:          http://localhost:3001"
    echo -e "  Alertmanager:     http://localhost:9093"
    echo -e "  Node Exporter:    http://localhost:9100"
    echo ""
}

# Health check function
wait_for_healthy() {
    local url=$1
    local name=$2
    local max_wait=60
    local waited=0
    local interval=2

    log_info "Waiting for $name to be healthy..."

    while [ $waited -lt $max_wait ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            log_success "$name is healthy!"
            return 0
        fi
        sleep $interval
        waited=$((waited + interval))
    done

    log_error "$name failed to become healthy within ${max_wait}s"
    return 1
}

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_build() {
    log_info "Building Docker images..."
    cd "$PROJECT_DIR"
    docker compose build --pull
    log_success "Build complete!"
}

cmd_start() {
    log_info "Starting DAP services..."
    cd "$PROJECT_DIR"

    # Stop existing containers first
    docker compose down --remove-orphans 2>/dev/null || true

    # Start services
    docker compose up -d

    # Wait for relay to be healthy
    if wait_for_healthy "http://localhost:3000/health" "DAP Relay"; then
        show_urls
        log_success "All services started!"
    else
        log_error "Failed to start services. Check logs with: ./$SCRIPT_NAME logs"
        exit 1
    fi
}

cmd_stop() {
    log_info "Stopping DAP services..."
    cd "$PROJECT_DIR"
    docker compose down
    log_success "All services stopped!"
}

cmd_logs() {
    local service=${1:-""}
    cd "$PROJECT_DIR"

    if [ -n "$service" ]; then
        log_info "Showing logs for: $service"
        docker compose logs -f --tail=100 "$service"
    else
        log_info "Showing logs for all services (Ctrl+C to exit)"
        docker compose logs -f --tail=50
    fi
}

cmd_status() {
    cd "$PROJECT_DIR"
    echo ""
    echo -e "${BOLD}Container Status:${NC}"
    echo ""
    docker compose ps --format table 2>/dev/null || {
        log_error "Failed to get container status. Are services running?"
        exit 1
    }
    echo ""
}

cmd_restart() {
    local service=${1:-""}
    cd "$PROJECT_DIR"

    if [ -n "$service" ]; then
        log_info "Restarting service: $service"
        docker compose restart "$service"
        log_success "$service restarted!"
    else
        log_info "Restarting all services..."
        docker compose restart
        log_success "All services restarted!"
    fi
}

cmd_clean() {
    log_warn "This will remove all containers, volumes, and images!"
    read -p "Are you sure? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cancelled."
        exit 0
    fi

    cd "$PROJECT_DIR"
    docker compose down -v --remove-orphans
    docker image prune -f
    log_success "Clean complete!"
}

cmd_help() {
    print_header
    echo "Usage: $SCRIPT_NAME <command> [options]"
    echo ""
    echo -e "${BOLD}Commands:${NC}"
    echo "  build              Build Docker images"
    echo "  start              Start all services (default)"
    echo "  stop               Stop all services"
    echo "  restart [service]  Restart all or specific service"
    echo "  logs [service]     Show logs (default: all services)"
    echo "  status             Show container status"
    echo "  clean              Remove containers, volumes, images"
    echo "  help               Show this help message"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  $SCRIPT_NAME build"
    echo "  $SCRIPT_NAME start"
    echo "  $SCRIPT_NAME logs prometheus"
    echo "  $SCRIPT_NAME restart dap-relay"
    echo ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

CMD=${1:-"help"}

case $CMD in
    build)
        cmd_build
        ;;
    start)
        cmd_start
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        cmd_restart "$2"
        ;;
    logs)
        cmd_logs "$2"
        ;;
    status)
        cmd_status
        ;;
    clean)
        cmd_clean
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        log_error "Unknown command: $CMD"
        echo "Run '$SCRIPT_NAME help' for usage."
        exit 1
        ;;
esac