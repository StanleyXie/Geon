# GEON

GEON is a powerful multi-provider agent for the [Agent Client Protocol](https://github.com/agentclientprotocol/protocol), designed specifically for the Zed editor. It features a sophisticated L1/L2/L3 context pipeline and built-in support for Claude, Gemini, and local models via OpenAI-compatible endpoints.

## Features

- **Multi-Provider Support**: Seamlessly switch between Anthropic Claude, Google Gemini, and local LLMs (via llama.cpp, Ollama, etc.).
- **Agentic Loop**: Native support for multi-turn tool execution within the protocol.
- **Context Pipeline**: Advanced token management with L1 (active), L2 (summarized), and L3 (archived) memory.
- **Rich Toolset**: 11 built-in tools for filesystem operations, terminal execution, and web search/fetch.
- **Search capabilities**:
  - **WebSearch**: Integrated with a local SearXNG instance for private, reliable search results.
  - **GoogleGroundedSearch**: High-fidelity search using Google's native grounding for cited, descriptive answers.
- **Observability**: Detailed token usage statistics for every turn and session.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime
- [Zed](https://zed.dev/) editor (Preview or Stable with ACP support)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/StanleyXie/Geon.git
   cd Geon
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Build the project:
   ```bash
   bun run build
   ```

### Configuration in Zed

Add the following to your `settings.json` in Zed to enable Geon:

```json
"agents": {
  "geon": {
    "command": "/path/to/Geon/dist/geon",
    "settings": {
      "google_api_key": "YOUR_GEMINI_API_KEY",
      "anthropic_api_key": "YOUR_CLAUDE_API_KEY",
      "local_enabled": true,
      "local_endpoint": "http://localhost:8000/v1"
    }
  }
}
```

## Built-in Tools

- **Filesystem**: `Read`, `Write`, `Edit`, `LS`, `Glob`, `Find`
- **Shell**: `Bash`
- **Web**: `WebFetch`, `WebSearch`, `GoogleGroundedSearch`, `Grep`

## License

MIT
