# ────────────────────────────────────────────────────────────────────
# bailian provider — uses the bl CLI (Aliyun Model Studio / CosyVoice).
#
# Docs:  https://bailian.aliyun.com/cli/install.md
# Auth:  bl auth login --api-key sk-...
# Voice: pass a cosyvoice voice id; default longxiaochun_v3 (龙小淳, 知性女声)
#        override default via BAILIAN_TTS_VOICE env var
#
# Drop-in for web-video-presentation: copy this file into
# presentation/scripts/tts-providers/bailian.sh then
#   PRESENTATION_TTS=bailian npm run synthesize-audio
# ────────────────────────────────────────────────────────────────────

tts_check() {
  if ! command -v bl >/dev/null; then
    echo "✗ bl CLI not found in PATH." >&2
    return 1
  fi
  if ! bl auth status >/dev/null 2>&1; then
    echo "✗ bl is not authenticated." >&2
    return 1
  fi
}

tts_install_help() {
  cat <<'EOF' >&2
To use the bailian (CosyVoice) provider:

  Install:  npm install -g bailian-cli
  Login:    bl auth login --api-key sk-xxxxx
            (get a key at https://bailian.console.aliyun.com/cli)

Or pick another provider:  PRESENTATION_TTS=<name> npm run synthesize-audio
See tts-providers/README.md for the list and how to add your own.
EOF
}

tts_synthesize() {
  local text="$1"
  local out="$2"
  local voice="${3:-}"

  # 两分支处理 voice,避开 macOS bash 3.2 空数组 + set -u 的坑
  # (对齐 minimax.sh 写法)
  if [[ -n "$voice" ]]; then
    bl speech synthesize --text "$text" --voice "$voice" --out "$out" --format mp3 \
      >/dev/null 2>&1
  else
    voice="${BAILIAN_TTS_VOICE:-longxiaochun_v3}"
    bl speech synthesize --text "$text" --voice "$voice" --out "$out" --format mp3 \
      >/dev/null 2>&1
  fi
}
