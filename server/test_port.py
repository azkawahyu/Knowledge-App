import socket
s = socket.socket()
s.settimeout(3)
r = s.connect_ex(('127.0.0.1', 5432))
print('Port 5432:', 'OPEN' if r == 0 else 'CLOSED')
s.close()
