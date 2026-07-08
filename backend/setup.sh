#!/bin/bash
set -e

# Python 3.14 is too new for pydantic-core. Use 3.12 instead.
PY=""
for candidate in python3.12 python3.11 python3.13; do
  if command -v $candidate &>/dev/null; then
    PY=$candidate
    break
  fi
done

if [ -z "$PY" ]; then
  echo "Installing Python 3.12 via Homebrew..."
  brew install python@3.12
  PY=python3.12
fi

echo "Using $PY ($(${PY} --version))"
rm -rf venv
$PY -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo ""
echo "✅ Backend ready!"
echo "Run: source venv/bin/activate && uvicorn main:app --reload"
