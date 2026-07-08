#!/bin/bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
echo ""
echo "✅ Done. Now run: source venv/bin/activate && uvicorn main:app --reload"
