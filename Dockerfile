FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装Python依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY app.py .
COPY static/ ./static/
COPY templates/ ./templates/

# 暴露端口
EXPOSE 5009

# 设置环境变量
ENV RUN_MODE=SERVER
ENV PORT=5009

# 初始化数据库并启动应用
CMD python -c "from app import app, db; app.app_context().push(); db.create_all(); from app import ensure_workspace_schema; ensure_workspace_schema()" && python app.py
