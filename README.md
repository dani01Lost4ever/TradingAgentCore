# Trading Agent



AI-powered crypto paper trading agent using Claude + Alpaca Paper API.

Logs every decision to MongoDB, resolves outcomes automatically, and exports profitable trades as a fine-tuning dataset.



## Stack

- **Agent**: Node.js + TypeScript

- **LLM**: Claude API (swap to Ollama after fine-tuning)

- **Paper trading**: Alpaca Paper API

- **Database**: MongoDB

- **Dashboard**: React + TypeScript (Vite)

- **Training**: Google Colab + Unsloth QLoRA



## Quick start

```bash

cp agent/.env.example agent/.env   # fill in your keys

docker compose up -d

# Dashboard → http://localhost:3000

# Agent API → http://localhost:3001/api/stats

```



## Agent API

| Endpoint | Description |

|---|---|

| `GET /api/trades` | All trade decisions |

| `GET /api/trades/pending` | Awaiting human approval |

| `GET /api/stats` | Win rate, P&L, dataset size |

| `POST /api/trades/:id/approve` | Approve + execute order |

| `POST /api/trades/:id/reject` | Dismiss without executing |

| `POST /api/dataset/export` | Export JSONL for training |



## Switching to local model

```env

LLM_PROVIDER=ollama

OLLAMA_BASE_URL=http://your-proxmox-ip:11434

OLLAMA_MODEL=trading-llm

```

