@echo off
set PATH=D:\Install\PostgreSQL\18\bin;%PATH%
psql -h 127.0.0.1 -U postgres -d postgres -c "SELECT version();"
