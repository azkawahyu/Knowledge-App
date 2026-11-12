# stop-dev-servers.sh — stops the two dev servers this report started.
# Only the PIDs currently LISTENING on :4000 (tsx server) and :3000 (next dev).
for p in 4000 3000; do
  PID=$(netstat -ano | grep -E ":$p[[:space:]].*LISTENING" | awk '{print $5}' | head -1)
  if [ -n "$PID" ]; then
    echo "stopping :$p (pid $PID)"
    taskkill /PID "$PID" /T /F 2>&1 | head -2
  else
    echo "nothing listening on :$p"
  fi
done
sleep 3
echo "--- listeners on 3000/4000 now ---"
netstat -ano | grep -E ':(3000|4000)[[:space:]].*LISTENING' || echo "both 3000 and 4000 free"