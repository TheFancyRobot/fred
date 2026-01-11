#!/bin/bash
# Helper script to activate Flox development environment for Fred

# Check if flox is installed
if ! command -v flox &> /dev/null; then
    echo "❌ Flox is not installed."
    echo ""
    echo "Install Flox:"
    echo "  macOS: brew install flox"
    echo "  Linux: curl -fsSL https://flox.dev/install | bash"
    echo ""
    echo "Or visit: https://flox.dev/docs/install-flox/install/"
    exit 1
fi

# Check if flox.nix exists
if [ ! -f "flox.nix" ]; then
    echo "❌ flox.nix not found. Are you in the Fred repository root?"
    exit 1
fi

# Activate Flox environment
echo "🐰 Activating Fred development environment with Flox..."
flox activate
