#!/bin/sh
# ONE BLISS - jalankan server di Linux / macOS / Raspberry Pi (setara mulai.bat)
cd "$(dirname "$0")" || exit 1
while true; do
  python3 server.py
  echo; echo "Server berhenti. Mulai ulang 5 detik... (Ctrl+C untuk berhenti)"
  sleep 5
done
