@echo off
echo Starting PostgreSQL server...
D:\Install\PostgreSQL\18\bin\postgres.exe -D D:\Install\PostgreSQL\18\data -p 5432
echo Server exited with code %ERRORLEVEL%
