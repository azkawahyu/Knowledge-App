import subprocess
import os

node_exe = "C:/Users/PC_DEV/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node.exe"
server_dir = "D:/Develop/knowledge-app/server"
log_path = os.path.join(server_dir, "server.log")

log = open(log_path, "w")
p = subprocess.Popen(
    [node_exe, "dist/index.js"],
    cwd=server_dir,
    creationflags=0x0000000b,  # CREATE_NEW_PROCESS_GROUP | CREATE_NEW_CONSOLE
    stdout=log,
    stderr=log,
)
print("spawned node pid:", p.pid)
