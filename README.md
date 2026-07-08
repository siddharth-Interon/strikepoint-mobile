# Strikepoint Mobile

iOS stock analysis app with FastAPI backend.

## Structure
- `backend/` — FastAPI Python API (wraps yfinance, Black-Scholes, AI agents)
- `mobile/` — React Native / Expo iOS app

## Backend setup
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # add your GROQ_API_KEY
uvicorn main:app --reload
```

## Mobile setup
```bash
cd mobile
npm install
npx expo start
```
Press `i` to open in iOS Simulator.
