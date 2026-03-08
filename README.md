# Geon: Quick Start Tutorial 🚀

Geon is an advanced [Agent Client Protocol](https://github.com/agentclientprotocol/protocol) agent built for the Zed editor. It gives your LLM (Claude, Gemini, or Local) full control over your filesystem, shell, and the web.

---

## ⚡ 1. Install Geon

Install it globally using your favorite package manager:

```bash
# Using Bun (Fastest)
bun install -g geon-agent

# Using NPM
npm install -g geon-agent
```

Check the binary path to use in Zed:
```bash
which geon
```

---

## ⚙️ 2. Configure Zed

Open your Zed `settings.json` (Cmd + ,) and add the following `agents` block:

```json
"agents": {
  "geon": {
    "command": "/usr/local/bin/geon", // Replace with your 'which geon' output
    "settings": {
      "google_api_key": "YOUR_GEMINI_API_KEY",
      "google_enabled": true,
      "anthropic_api_key": "YOUR_CLAUDE_API_KEY",
      "anthropic_enabled": true,
      "local_enabled": false // Set to true if running a local LLM
    }
  }
}
```

---

## 🌩️ 3. Start Sidecar Services (Optional)

Geon features a private **Web Search** tool powered by [SearXNG](https://searxng.github.io/searxng/). To use it, you can run the included helper script:

```bash
# In your source directory, or download geon-env.sh
./geon-env.sh start
```
*This starts a local SearXNG container (Podman/Docker) and a local LLM server (llama-server).*

---

## 🧤 4. Your First Geon Prompt

Once setup, open an ACP session in Zed and select `Geon` as your agent.

**Try asking it to perform a complex cross-file task:**
> "Find all TODOs in this project using Grep, research the latest Zed plugin API changes with WebSearch, and write a summary in a new file called ARCHITECTURE_PLAN.md."

---

## 🧠 Why Geon?

### The Context Strategy: L1/L2/L3
Unlike simple agents, Geon manages its memory like a human developer:
- **L1 (Active)**: Recent messages kept in full fidelity.
- **L2 (Context)**: Middle-range messages summarized to save tokens.
- **L3 (Archive)**: Old messages archived for deep retrieval.

### Multi-Provider Agentic Loop
Geon doesn't just "propose" edits. It executes them, sees the output, fixes bugs, and continues until the job is done.

### Built-in Tool Matrix
| Filesystem | Shell | Web & Search |
| :--- | :--- | :--- |
| `Read`, `Write` | `Bash` | `WebSearch` (SearXNG) |
| `Edit`, `LS` | | `WebFetch` (Readable Text) |
| `Glob`, `Find` | | `GoogleGroundedSearch` |

---

## 📜 License
MIT © 2026 Stanley Xie
