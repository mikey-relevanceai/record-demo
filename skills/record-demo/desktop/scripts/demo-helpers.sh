#!/usr/bin/env bash
# Smooth, human-paced cursor helpers for the demo recording.
# Honours a DISPLAY set by the caller (per-run token :$N); defaults to :99.
export DISPLAY="${DISPLAY:-:99}"

smooth_move() { # smooth_move X Y [steps]
  local tx=$1 ty=$2 steps=${3:-30}
  eval "$(xdotool getmouselocation --shell)" # sets X, Y
  local sx=$X sy=$Y i
  for ((i = 1; i <= steps; i++)); do
    # ease-in-out via smoothstep t*t*(3-2t)
    local t
    t=$(awk -v i="$i" -v n="$steps" 'BEGIN { u = i / n; print u * u * (3 - 2 * u) }')
    local nx ny
    nx=$(awk -v a="$sx" -v b="$tx" -v t="$t" 'BEGIN { printf "%d", a + (b - a) * t }')
    ny=$(awk -v a="$sy" -v b="$ty" -v t="$t" 'BEGIN { printf "%d", a + (b - a) * t }')
    xdotool mousemove "$nx" "$ny"
    sleep 0.016
  done
}

move_click() { # move_click X Y [pause-after]
  smooth_move "$1" "$2"
  sleep 0.35
  xdotool click 1
  sleep "${3:-1.5}"
}

type_text() { # type_text TEXT [delay-ms] [pause-after]
  xdotool type --clearmodifiers --delay "${2:-45}" -- "$1"
  sleep "${3:-0.7}"
}

press_key() { # press_key CHORD [pause-after]
  xdotool key --clearmodifiers "$1"
  sleep "${2:-0.5}"
}
