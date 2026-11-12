@echo off
D:\Install\PostgreSQL\18\bin\psql -h 127.0.0.1 -U knowledge_app -d knowledge_app -c "SELECT current_user, current_database();"
