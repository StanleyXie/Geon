#!/bin/bash

# Configuration
SEARXNG_NAME="geon-searxng"
SEARXNG_PORT=8080
LOCAL_MODEL_PORT=8000
# Updated to your requested model and backend
DEFAULT_MODEL="unsloth/Qwen3.5-9B-GGUF:Q4_K_M"
LOCAL_MODEL_LOG="local_model_server.log"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

function log_info() { echo -e "${BLUE}[GEON]${NC} $1"; }
function log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
function log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

function check_podman() {
    if ! command -v podman &> /dev/null; then
        log_error "Podman is not installed."
        return 1
    fi
    if podman machine inspect podman-machine-default --format '{{.State}}' 2>/dev/null | grep -iq "running"; then
        log_info "Podman machine is already running."
    else
        log_info "Starting Podman machine..."
        podman machine start
    fi
}

function start_services() {
    check_podman || return 1

    # 1. Start SearXNG
    if podman ps -a --format "{{.Names}}" | grep -q "^${SEARXNG_NAME}$"; then
        log_info "Starting existing SearXNG container..."
        podman start "$SEARXNG_NAME"
    else
        log_info "Creating and starting new SearXNG container..."
        SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
        CONFIG_PATH="$SCRIPT_DIR/../searxng/settings.yml"
        podman run -d --name "$SEARXNG_NAME" \
            -p 127.0.0.1:${SEARXNG_PORT}:8080 \
            -v "${CONFIG_PATH}:/etc/searxng/settings.yml:ro" \
            docker.io/searxng/searxng
    fi

    # 2. Start Local Model Server (llama-server)
    if lsof -Pi :${LOCAL_MODEL_PORT} -sTCP:LISTEN -t >/dev/null ; then
        log_info "Local model server already running on port ${LOCAL_MODEL_PORT}."
    else
        log_info "Starting llama-server on port ${LOCAL_MODEL_PORT} with model ${DEFAULT_MODEL}..."
        
        # Use the specific llama-server configuration provided by the user
        nohup llama-server \
            -hf "$DEFAULT_MODEL" \
            --gpu-layers all \
            --flash-attn on \
            -t 8 \
            --ctx-size 262144 \
            --batch-size 2048 \
            --ubatch-size 1024 \
            -ctk q4_0 -ctv q4_0 \
            --mlock \
            --host 0.0.0.0 \
            --port "$LOCAL_MODEL_PORT" > "$LOCAL_MODEL_LOG" 2>&1 &
            
        echo $! > .local_model_pid
        log_success "Local model server (llama-server) started with PID $(cat .local_model_pid)"
    fi

    log_success "All services are starting up!"
    echo "- SearXNG: http://127.0.0.1:${SEARXNG_PORT}"
    echo "- Local Model: http://127.0.0.1:${LOCAL_MODEL_PORT}"
}

function stop_services() {
    log_info "Stopping services..."

    # 1. Stop SearXNG
    if podman ps --format "{{.Names}}" | grep -q "^${SEARXNG_NAME}$"; then
        podman stop "$SEARXNG_NAME"
        log_success "SearXNG stopped."
    fi

    # 2. Stop Local Model Server
    if [ -f .local_model_pid ]; then
        pid=$(cat .local_model_pid)
        if ps -p $pid > /dev/null; then
            kill $pid
            log_success "Local model server (PID $pid) stopped."
        fi
        rm .local_model_pid
    else
        # Fallback: kill by port
        pid=$(lsof -ti :${LOCAL_MODEL_PORT})
        if [ ! -z "$pid" ]; then
            kill $pid
            log_success "Local model server on port ${LOCAL_MODEL_PORT} killed."
        fi
    fi
}

function show_status() {
    echo -e "${BLUE}--- GEON Service Status ---${NC}"
    
    # Podman/SearXNG
    if podman ps --format "{{.Names}}" | grep -q "^${SEARXNG_NAME}$"; then
        echo -e "SearXNG:      ${GREEN}RUNNING${NC} (Port ${SEARXNG_PORT})"
    else
        echo -e "SearXNG:      ${RED}STOPPED${NC}"
    fi

    # Local Model
    if lsof -Pi :${LOCAL_MODEL_PORT} -sTCP:LISTEN -t >/dev/null ; then
        echo -e "Local Model:  ${GREEN}RUNNING${NC} (Port ${LOCAL_MODEL_PORT})"
    else
        echo -e "Local Model:  ${RED}STOPPED${NC}"
    fi
}

case "$1" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        sleep 2
        start_services
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
esac
