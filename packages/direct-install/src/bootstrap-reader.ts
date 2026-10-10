export const STOP_OWNED_TREE = `stop_tree() {
  local parent child children depth
  parent="$1"; depth="$2"
  [ "$depth" -lt 16 ] || return 1
  /bin/kill -STOP "$parent" 2>/dev/null || return 0
  children=$(/bin/ps -axo pid=,ppid= | /usr/bin/awk -v parent="$parent" '$2==parent {print $1}')
  for child in $children; do stop_tree "$child" "$((depth+1))"; done
  /bin/kill -KILL "$parent" 2>/dev/null || true
}
`;

export function buildBootstrapReader(): string {
	// Shells reap exited jobs before wait; the wrappers must stay alive until acknowledgement.
	return `set -eu
umask 077
work="$1"
deadline="$2"
shift 2
reader=''
copier=''
stream="$work/bootstrap-stream"
completion="$work/bootstrap-completion"
acknowledgement="$work/bootstrap-acknowledgement"
${STOP_OWNED_TREE}
cleanup() {
  if [ -n "$reader" ]; then stop_tree "$reader" 0; wait "$reader" 2>/dev/null || true; fi
  if [ -n "$copier" ]; then stop_tree "$copier" 0; wait "$copier" 2>/dev/null || true; fi
  /bin/rm -f "$stream" "$completion" "$acknowledgement"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
/usr/bin/mkfifo -m 600 "$stream" "$completion" "$acknowledgement"
exec 3<>"$completion"
exec 4<>"$acknowledgement"
( set +e; trap '' HUP INT TERM; "$@" >"$stream" 3>&- 4>&-; status=$?; /usr/bin/printf 'reader:%s\\n' "$status" >&3; IFS= read -r acknowledgement <&4 ) &
reader=$!
( set +e; trap '' HUP INT TERM; /bin/cat "$stream" 3>&- 4>&-; status=$?; /usr/bin/printf 'copier:%s\\n' "$status" >&3; IFS= read -r acknowledgement <&4 ) &
copier=$!
status=0
seen=''
for ignored in 1 2; do
  if ! IFS= read -r -t "$deadline" result <&3; then exit 124; fi
  case "$result" in reader:*|copier:*) ;; *) exit 65;; esac
  kind=${"$"}{result%%:*}; code=${"$"}{result#*:}
  case "$code" in ''|*[!0-9]*) exit 65;; esac
  case " $seen " in *" $kind "*) exit 65;; esac
  seen="$seen $kind"
  if [ "$status" = 0 ]; then status="$code"; fi
done
completed_reader="$reader"
completed_copier="$copier"
reader=''
copier=''
/usr/bin/printf 'complete\\ncomplete\\n' >&4
wait "$completed_reader" || true
wait "$completed_copier" || true
exec 3>&-
exec 4>&-
exit "$status"
`;
}
