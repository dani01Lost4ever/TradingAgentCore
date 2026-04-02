#!/bin/bash
# deploy-ollama.sh
# Run this on your Proxmox LXC after downloading the GGUF from Colab
# Usage: bash deploy-ollama.sh /path/to/trading-llm.Q4_K_M.gguf

set -e

GGUF_FILE="${1:-./trading-llm.Q4_K_M.gguf}"
MODEL_NAME="trading-llm"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Trading LLM Deployment ==="
echo "GGUF: $GGUF_FILE"
echo "Model name: $MODEL_NAME"
echo ""

# Check file exists
if [ ! -f "$GGUF_FILE" ]; then
  echo "ERROR: GGUF file not found at $GGUF_FILE"
  exit 1
fi

# Install Ollama if missing
if ! command -v ollama &> /dev/null; then
  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
  echo "Ollama installed"
fi

# Start Ollama service
echo "Starting Ollama service..."
ollama serve &>/dev/null &
sleep 3

# Copy GGUF to working directory for Modelfile context
WORK_DIR="/tmp/trading-llm-deploy"
mkdir -p "$WORK_DIR"
cp "$GGUF_FILE" "$WORK_DIR/trading-llm.Q4_K_M.gguf"
cp "$SCRIPT_DIR/Modelfile" "$WORK_DIR/Modelfile"

# Create/update model
echo "Registering model with Ollama..."
cd "$WORK_DIR"
ollama create "$MODEL_NAME" -f Modelfile

# Test inference
echo ""
echo "=== Testing inference ==="
TEST_INPUT='{"market":{"BTC/USD":{"price":82400,"change_24h":-2.1,"rsi_14":38,"high_24h":85000,"low_24h":81200,"volume_24h":1200000000}},"portfolio":{"cash_usd":8200,"positions":{}}}'

echo "Input: market snapshot (BTC/USD $82,400, RSI 38)"
echo "Response:"
echo "$TEST_INPUT" | ollama run "$MODEL_NAME"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Next steps:"
echo "  1. Update agent .env:"
echo "     LLM_PROVIDER=ollama"
echo "     OLLAMA_BASE_URL=http://localhost:11434"
echo "     OLLAMA_MODEL=trading-llm"
echo "  2. Restart the agent: docker compose restart agent"
echo "  3. Verify: curl http://localhost:3001/api/stats"
