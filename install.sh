#!/bin/bash
# Hive Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/sreekar2403/hive/main/install.sh | bash
# Or: npx hive@latest (once published) or pnpm install && pnpm dev:server

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

HIVE_VERSION="latest"
INSTALL_DIR="${HOME}/.hive"
REPO_URL="https://github.com/sreekar2403/hive"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Hive Installer                              ║${NC}"
echo -e "${BLUE}║     Multi-agent orchestration framework                        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check for required commands
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed${NC}"
        echo "Please install $1 and try again."
        exit 1
    fi
}

echo "Checking prerequisites..."
check_command "node"
check_command "npm"
check_command "git"

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo -e "${RED}Error: Node.js 22+ is required (found v$NODE_VERSION)${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node --version)"
echo -e "${GREEN}✓${NC} npm $(npm --version)"
echo -e "${GREEN}✓${NC} git $(git --version | cut -d' ' -f3)"

# Check for CLI agents
echo ""
echo "Checking for CLI agents (at least one required)..."
AGENTS_FOUND=0

if command -v opencode &> /dev/null; then
    echo -e "${GREEN}✓${NC} opencode $(opencode --version 2>/dev/null || echo 'installed')"
    AGENTS_FOUND=$((AGENTS_FOUND + 1))
fi

if command -v claude &> /dev/null; then
    echo -e "${GREEN}✓${NC} claude-code $(claude --version 2>/dev/null || echo 'installed')"
    AGENTS_FOUND=$((AGENTS_FOUND + 1))
fi

if command -v pi &> /dev/null; then
    echo -e "${GREEN}✓${NC} pi $(pi --version 2>/dev/null || echo 'installed')"
    AGENTS_FOUND=$((AGENTS_FOUND + 1))
fi

if [ $AGENTS_FOUND -eq 0 ]; then
    echo -e "${YELLOW}⚠${NC} No CLI agents found. You'll need to install at least one:"
    echo "  - opencode: npm install -g opencode"
    echo "  - claude-code: npm install -g @anthropic-ai/claude-code"
    echo "  - pi: npm install -g pi"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Install method
echo ""
echo "Choose installation method:"
echo "  1) npx (recommended - no global install needed)"
echo "  2) Clone and build from source"
echo "  3) Global npm install"
read -p "Choice [1-3]: " -n 1 -r INSTALL_METHOD
echo ""

case $INSTALL_METHOD in
    1)
        echo "Using npx..."
        echo ""
        echo "You can now run Hive with:"
        echo -e "  ${GREEN}npx hive@latest${NC}"
        echo ""
        echo "Or run specific commands:"
        echo -e "  ${GREEN}npx hive@latest${NC}          # Start everything (server + UI + desktop)"
        echo -e "  ${GREEN}npx hive@latest web${NC}      # Server + UI only"
        echo -e "  ${GREEN}npx hive@latest server${NC}   # Server only"
        echo -e "  ${GREEN}npx hive@latest doctor${NC}   # Check setup"
        ;;
    2)
        echo "Cloning from source..."
        TEMP_DIR=$(mktemp -d)
        git clone "$REPO_URL" "$TEMP_DIR/hive"
        cd "$TEMP_DIR/hive"
        echo "Installing dependencies (pnpm required)..."
        if ! command -v pnpm &> /dev/null; then
            echo "Installing pnpm..."
            npm install -g pnpm
        fi
        pnpm install
        echo "Building..."
        pnpm build
        echo ""
        echo -e "${GREEN}✓${NC} Built successfully!"
        echo ""
        echo "To run Hive:"
        echo -e "  ${GREEN}cd $TEMP_DIR/hive && npm run hive${NC}"
        echo ""
        echo "Or add to PATH:"
        echo -e "  ${GREEN}export PATH=\"$TEMP_DIR/hive/bin:\$PATH\"${NC}"
        ;;
    3)
        echo "Installing globally via npm..."
        npm install -g hive@latest
        echo ""
        echo -e "${GREEN}✓${NC} Installed globally!"
        echo ""
        echo "You can now run Hive from anywhere:"
        echo -e "  ${GREEN}hive${NC}"
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Run ${GREEN}hive doctor${NC} to verify your setup (add --deep to test event streams)"
echo "2. Hive uses whatever CLIs you already authenticated (claude /login, codex login, opencode auth). No API keys in Hive."
echo "   For local models, set Ollama/LM Studio URLs in Settings → Models or hive.config.json."
echo "3. Start Hive with ${GREEN}hive${NC} and open http://localhost:3000"
echo ""
echo "Documentation: https://github.com/sreekar2403/hive#readme"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"