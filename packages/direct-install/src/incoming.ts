import { posix } from "node:path";
import { STOP_OWNED_TREE } from "./bootstrap-reader";
import { hasControlCharacters, safeReleasePath } from "./release";

export const INCOMING_SLOT_BYTES = 2 * 1024 * 1024 * 1024;
export const INCOMING_MAX_SLOTS = 4;
export const INCOMING_MAX_ENTRIES = 50000;
const ENTRY_RESERVE_BYTES = 4096;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function incomingReservationBytes(
	payloadBytes: number,
	paths: string[],
): number {
	const directories = new Set(["."]);
	for (const path of paths) {
		safeReleasePath(path);
		let directory = posix.dirname(path);
		while (directory !== ".") {
			directories.add(directory);
			directory = posix.dirname(directory);
		}
	}
	const entries = paths.length + directories.size;
	const bytes = payloadBytes + entries * ENTRY_RESERVE_BYTES;
	if (
		!Number.isSafeInteger(payloadBytes) ||
		payloadBytes < 0 ||
		entries > INCOMING_MAX_ENTRIES ||
		bytes > INCOMING_SLOT_BYTES
	)
		throw new Error("The release exceeds the incoming upload cache budget");
	return bytes;
}

export function buildIncomingAdmission(input: {
	userHome: string;
	uid: number;
	installId: string;
	reservedBytes: number;
	maximumEntries?: number;
}): string {
	const maximumEntries = input.maximumEntries ?? INCOMING_MAX_ENTRIES;
	if (
		!input.userHome.startsWith("/") ||
		posix.normalize(input.userHome) !== input.userHome ||
		hasControlCharacters(input.userHome) ||
		!Number.isSafeInteger(input.uid) ||
		input.uid < 0 ||
		!UUID.test(input.installId) ||
		!Number.isSafeInteger(input.reservedBytes) ||
		input.reservedBytes < 1 ||
		input.reservedBytes > INCOMING_SLOT_BYTES ||
		!Number.isSafeInteger(maximumEntries) ||
		maximumEntries < 1 ||
		maximumEntries > INCOMING_MAX_ENTRIES
	)
		throw new Error("Invalid incoming upload admission request");
	return `set -eu
umask 077
export LC_ALL=C
expected_uid=${input.uid}
base=${quote(posix.join(input.userHome, ".superset-direct"))}
root="$base/incoming"
scan_root="$root/.admission-scan"
scan_pid=''
scan_fifo=''
scan_completion=''
scan_acknowledgement=''
install_id=${quote(input.installId)}
owner="superset-upload-lock-$$-$install_id"
format=$(/usr/bin/uname -s)
[ "$(/usr/bin/id -u)" = "$expected_uid" ] || exit 65
case "$format" in Darwin) stat_flag=-f; stat_format='%u %p %z %l'; radix=8;; Linux) stat_flag=-c; stat_format='%u %f %s %h'; radix=16;; *) exit 65;; esac
metadata() { /usr/bin/stat "$stat_flag" "$stat_format" "$1"; }
is_uuid() {
  /usr/bin/printf '%s\\n' "$1" | /usr/bin/awk 'length($0)==36 && split($0,a,"-")==5 && length(a[1])==8 && length(a[2])==4 && length(a[3])==4 && length(a[4])==4 && length(a[5])==12 && $0 !~ /[^0-9a-f-]/ {ok=1} END {exit !ok}'
}
check_records() {
  /usr/bin/awk -v uid="$expected_uid" -v radix="$radix" -v limit=${INCOMING_SLOT_BYTES} -v maximum=${maximumEntries} '
  function fail(code) {bad=1; exit code}
  function mode_value(text, value,i,digit) {
    value=0; for(i=1;i<=length(text);i++) {digit=index("0123456789abcdef",tolower(substr(text,i,1)))-1; if(digit<0 || digit>=radix) fail(65); value=value*radix+digit} return value
  }
  {
    if(NF!=4 || $1 !~ /^[0-9]+$/ || $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ || $1!=uid) fail(65)
    mode=mode_value($2); kind=int(mode/4096); permission=mode%4096
    if(kind==4) {if(permission!=448) fail(65)}
    else if(kind==8) {if(permission>511 || int(permission/16)%2 || int(permission/2)%2 || $4!=1) fail(65); bytes+=$3}
    else fail(65)
    bytes+=${ENTRY_RESERVE_BYTES}; count++
    if(bytes>limit || count>maximum) fail(66)
  }
  END {if(!bad) {if(count<1) exit 65; print bytes}}
  '
}
private_directory() {
  [ ! -L "$1" ] && [ -d "$1" ] || exit 65
  metadata "$1" | check_records >/dev/null
}
for directory in "$base" "$root"; do
  /bin/mkdir "$directory" 2>/dev/null || [ -d "$directory" ] || exit 65
  private_directory "$directory"
done
lock_pid() {
  local lock_path target remainder pid token record
  lock_path="$1"
  [ -L "$lock_path" ] || { [ -e "$lock_path" ] && exit 65; exit 75; }
  record=$(metadata "$lock_path") || exit 75
  [ "${"$"}{record%% *}" = "$expected_uid" ] || exit 65
  target=$(/usr/bin/readlink "$lock_path") || exit 75
  case "$target" in superset-upload-lock-*) remainder=${"$"}{target#superset-upload-lock-};; *) exit 65;; esac
  pid=${"$"}{remainder%%-*}; token=${"$"}{remainder#*-}
  case "$pid" in ''|*[!0-9]*) exit 65;; esac
  [ "$pid" -ge 1 ] && [ "$pid" -le 2147483647 ] && is_uuid "$token" || exit 65
  /usr/bin/printf '%s\\n' "$pid"
}
live_pid() { /bin/kill -0 "$1" 2>/dev/null || [ -n "$(/bin/ps -p "$1" -o pid= 2>/dev/null)" ]; }
${STOP_OWNED_TREE}
release_lock() {
  if [ "$(/usr/bin/readlink "$1" 2>/dev/null || true)" = "$owner" ]; then /bin/rm "$1"; fi
}
stop_scan() {
  if [ -n "$scan_pid" ]; then
    stop_tree "$scan_pid" 0
    wait "$scan_pid" 2>/dev/null || true
    scan_pid=''
  fi
}
cleanup() {
  stop_scan
  if [ -n "$scan_fifo" ]; then /bin/rm -f "$scan_fifo"; fi
  if [ -n "$scan_completion" ]; then /bin/rm -f "$scan_completion"; fi
  if [ -n "$scan_acknowledgement" ]; then /bin/rm -f "$scan_acknowledgement"; fi
  release_lock "$root/.admission.lock"
}
acquire_lock() {
  local lock_path depth pid
  lock_path="$1"; depth="$2"
  [ "$depth" -le 16 ] || exit 65
  if [ ! -e "$lock_path" ] && [ ! -L "$lock_path" ]; then
    if /bin/ln -s -n "$owner" "$lock_path" 2>/dev/null; then
      [ "$(/usr/bin/readlink "$lock_path")" = "$owner" ] || exit 65
      return
    fi
  fi
  pid=$(lock_pid "$lock_path")
  if live_pid "$pid"; then exit 75; fi
  acquire_lock "$lock_path.recovery" "$((depth+1))"
  pid=$(lock_pid "$lock_path")
  if live_pid "$pid"; then exit 75; fi
  /bin/rm "$lock_path"
  /bin/ln -s -n "$owner" "$lock_path"
  release_lock "$lock_path.recovery"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
acquire_lock "$root/.admission.lock" 0
/bin/mkdir "$scan_root" 2>/dev/null || [ -d "$scan_root" ] || exit 65
private_directory "$scan_root"
for previous in "$scan_root"/* "$scan_root"/.[!.]* "$scan_root"/..?*; do
  [ -e "$previous" ] || [ -L "$previous" ] || continue
  name=${"$"}{previous##*/}
  case "$name" in records-*|completion-*|acknowledgement-*) is_uuid "${"$"}{name#*-}" || exit 65;; *) exit 65;; esac
  record=$(metadata "$previous")
  case "$format" in Darwin) fifo_mode=10600;; Linux) fifo_mode=1180;; esac
  [ "$record" = "$expected_uid $fifo_mode 0 1" ] || exit 65
  /bin/rm "$previous"
done
scan_fifo="$scan_root/records-$install_id"
scan_completion="$scan_root/completion-$install_id"
scan_acknowledgement="$scan_root/acknowledgement-$install_id"
/usr/bin/mkfifo -m 600 "$scan_fifo" "$scan_completion" "$scan_acknowledgement"
exec 3<>"$scan_completion"
exec 4<>"$scan_acknowledgement"
slots=0
root_entries=0
for entry in "$root"/* "$root"/.[!.]* "$root"/..?*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  root_entries=$((root_entries+1))
  [ "$root_entries" -le 32 ] || exit 66
  name=${"$"}{entry##*/}
  case "$name" in .admission.lock|.admission.lock.recovery*) lock_pid "$entry" >/dev/null; continue;; esac
  case "$name" in .admission-scan) private_directory "$entry"; continue;; esac
  case "$name" in *.partial) is_uuid "${"$"}{name%.partial}" || exit 65;; *) exit 65;; esac
  private_directory "$entry"
  slots=$((slots+1))
  [ "$slots" -lt ${INCOMING_MAX_SLOTS} ] || exit 66
  ( set +e; trap '' HUP INT TERM; /usr/bin/find "$entry" -xdev -exec /usr/bin/stat "$stat_flag" "$stat_format" {} + >"$scan_fifo" 3>&- 4>&-; status=$?; /usr/bin/printf '%s\\n' "$status" >&3; IFS= read -r acknowledgement <&4 ) &
  scan_pid=$!
  scan_status=0
  check_records <"$scan_fifo" >/dev/null || scan_status=$?
  if [ "$scan_status" -ne 0 ]; then stop_scan; exit "$scan_status"; fi
  producer_status=0
  IFS= read -r producer_status <&3
  completed_scan="$scan_pid"
  scan_pid=''
  /usr/bin/printf 'complete\\n' >&4
  wait "$completed_scan" || true
  [ "$producer_status" = 0 ] || exit 65
done
/bin/mkdir "$root/$install_id.partial"
/usr/bin/printf 'SUPERSET_DIRECT_INCOMING=%s\\n' "$install_id"
`;
}
