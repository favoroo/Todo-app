import os
import logging
import re
import sys
import json
import socket
import time
from typing import Optional, Dict, Any, List
from flask import Flask, render_template, request, jsonify, g
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, text


RUN_MODE = os.environ.get('RUN_MODE', 'SERVER')
STATIC_EXPORT_IP = os.environ.get('STATIC_EXPORT_IP', "")
PORT = int(os.environ.get('PORT', 5009))
MAX_CONTENT_LENGTH = int(os.environ.get('MAX_CONTENT_LENGTH', 10 * 1024 * 1024))
ROUTE_PREFIX = os.environ.get('ROUTE_PREFIX', "")

# --- 基础配置 ---
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'todo_app.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- 数据库模型 (已修改) ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ip_address = db.Column(db.String(45), unique=True, nullable=False)
    workspaces = db.relationship('Workspace', backref='user', lazy=True, cascade="all, delete-orphan")

class Workspace(db.Model):
    __tablename__ = 'workspace'
    
    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.String(36), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    order_index = db.Column(db.Integer, nullable=False, default=0, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    
    projects_json = db.Column(db.LargeBinary, nullable=False)
    notes_json = db.Column(db.LargeBinary, nullable=False)
    shapes_json = db.Column(db.LargeBinary, nullable=True)
    emojis_json = db.Column(db.LargeBinary, nullable=True)
    photos_json = db.Column(db.LargeBinary, nullable=True)
    folders_json = db.Column(db.LargeBinary, nullable=True)
    
    __table_args__ = (
        UniqueConstraint('user_id', 'client_id', name='_user_client_uc'),
    )

# --- 辅助函数 ---
def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def create_default_workspace(user):
    return Workspace(
        client_id=f"ws_{int(time.time() * 1000)}",
        name="我的工作区",
        user=user,
        projects_json='{}'.encode('utf-8'),
        notes_json='{}'.encode('utf-8'),
        shapes_json='{}'.encode('utf-8'),
        emojis_json='{}'.encode('utf-8'),
        photos_json='{}'.encode('utf-8'),
        folders_json='{}'.encode('utf-8')
    )

def ensure_workspace_schema():
    with db.engine.begin() as conn:
        columns = [row[1] for row in conn.execute(text("PRAGMA table_info(workspace)")).fetchall()]
        if 'shapes_json' not in columns:
            conn.execute(text("ALTER TABLE workspace ADD COLUMN shapes_json BLOB"))
        if 'emojis_json' not in columns:
            conn.execute(text("ALTER TABLE workspace ADD COLUMN emojis_json BLOB"))
        if 'photos_json' not in columns:
            conn.execute(text("ALTER TABLE workspace ADD COLUMN photos_json BLOB"))
        if 'folders_json' not in columns:
            conn.execute(text("ALTER TABLE workspace ADD COLUMN folders_json BLOB"))

def safe_json_loads(data: Optional[bytes], default: Optional[Dict] = None) -> Dict[str, Any]:
    if default is None:
        default = {}
    if not data:
        return default
    try:
        return json.loads(data.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return default

def serialize_workspace(ws: Workspace) -> Dict[str, Any]:
    return {
        "id": ws.client_id,
        "name": ws.name,
        "projects": safe_json_loads(ws.projects_json),
        "notes": safe_json_loads(ws.notes_json),
        "shapes": safe_json_loads(ws.shapes_json),
        "emojis": safe_json_loads(ws.emojis_json),
        "photos": safe_json_loads(ws.photos_json),
        "folders": safe_json_loads(ws.folders_json)
    }

class FilteredStream:
    def __init__(self, stream, patterns, log_path=None):
        self.stream = stream
        self.patterns = [re.compile(p) for p in patterns]
        self.log_path = log_path

    def write(self, message):
        if any(p.search(message) for p in self.patterns):
            if self.log_path:
                try:
                    with open(self.log_path, 'a', encoding='utf-8') as f:
                        f.write(message)
                except Exception:
                    pass
            return
        self.stream.write(message)

    def flush(self):
        if hasattr(self.stream, 'flush'):
            self.stream.flush()

# --- 请求钩子 ---
@app.before_request
def get_current_user():
    if RUN_MODE in ['SERVER', 'WEBVIEW']:
        ip = request.headers.get('X-Forwarded-For', request.remote_addr) if RUN_MODE == 'SERVER' else "127.0.0.1"
        
        user = User.query.filter_by(ip_address=ip).first()
        if not user:
            user = User(ip_address=ip)
            db.session.add(user)
            db.session.add(create_default_workspace(user))
            db.session.commit()
            print(f"[workspace] created default workspace for new user {ip}")
        g.user = user

# --- 路由 ---
@app.route(f'{ROUTE_PREFIX}/' if ROUTE_PREFIX else '/')
def index():
    if RUN_MODE not in ['SERVER', 'WEBVIEW']:
        return "Not in a server-based mode", 404
    
    user = g.user
    user_workspaces = Workspace.query.filter_by(user_id=user.id).order_by(Workspace.order_index).all()
    if not user_workspaces:
        db.session.add(create_default_workspace(user))
        db.session.commit()
        print(f"[workspace] no workspaces found; created default for user {user.ip_address}")
        user_workspaces = Workspace.query.filter_by(user_id=user.id).order_by(Workspace.order_index).all()
    
    workspaces_data = [serialize_workspace(ws) for ws in user_workspaces]

    initial_data = { "currentWorkspaceIndex": 0, "workspaces": workspaces_data }
    template_mode = 'SERVER' if RUN_MODE in ['SERVER', 'WEBVIEW'] else 'STATIC'
    
    return render_template('index.html', initial_data=initial_data, mode=template_mode, run_mode=RUN_MODE)

@app.route(f'{ROUTE_PREFIX}/api/save', methods=['POST'])
def save_data():
    user = g.user
    data_from_client = request.get_json()
    
    if not data_from_client or 'workspaces' not in data_from_client:
        return jsonify({"status": "error", "message": "Invalid or no data provided"}), 400

    client_workspaces_data = data_from_client.get('workspaces')
    
    if not isinstance(client_workspaces_data, list):
        return jsonify({"status": "error", "message": "workspaces must be a list"}), 400
    
    try:
        client_ids = {str(ws_data.get('id')) for ws_data in client_workspaces_data if ws_data.get('id')}
        
        existing_workspaces = {
            ws.client_id: ws for ws in Workspace.query.filter_by(user_id=user.id).all()
        }
        
        for client_id in set(existing_workspaces.keys()) - client_ids:
            db.session.delete(existing_workspaces[client_id])
        
        for index, ws_data in enumerate(client_workspaces_data):
            client_id = str(ws_data.get('id')) if ws_data.get('id') else None
            if not client_id:
                continue

            workspace_data = {
                'name': ws_data.get('name', 'Untitled'),
                'projects_json': json.dumps(ws_data.get('projects', {})).encode('utf-8'),
                'notes_json': json.dumps(ws_data.get('notes', {})).encode('utf-8'),
                'shapes_json': json.dumps(ws_data.get('shapes', {})).encode('utf-8'),
                'emojis_json': json.dumps(ws_data.get('emojis', {})).encode('utf-8'),
                'photos_json': json.dumps(ws_data.get('photos', {})).encode('utf-8'),
                'folders_json': json.dumps(ws_data.get('folders', {})).encode('utf-8'),
                'order_index': index,
            }

            if client_id in existing_workspaces:
                ws = existing_workspaces[client_id]
                for key, value in workspace_data.items():
                    setattr(ws, key, value)
            else:
                new_workspace = Workspace(
                    client_id=client_id,
                    user_id=user.id,
                    **workspace_data
                )
                db.session.add(new_workspace)

        db.session.commit()
        return jsonify({"status": "ok", "message": "Data saved successfully"})

    except Exception as e:
        db.session.rollback()
        import traceback
        print("="*50); print(f"CRITICAL ERROR during save for user {user.ip_address}:"); traceback.print_exc(); print("="*50)
        return jsonify({"status": "error", "message": f"Database commit failed. Check server logs."}), 500

@app.route(f'{ROUTE_PREFIX}/api/log', methods=['POST'])
def log_client_event():
    payload = request.get_json() or {}
    message = payload.get('message', '')
    data = payload.get('data', {})
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output.log')
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
    try:
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(f"[reminder] {timestamp} {message} {json.dumps(data, ensure_ascii=False)}\n")
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# --- 静态HTML生成函数 ---
def build_static_html():
    print("--- Running in STATIC build mode ---")
    with app.app_context():
        user_to_export = User.query.filter_by(ip_address=STATIC_EXPORT_IP).first() if STATIC_EXPORT_IP else User.query.first()
        
        if not user_to_export:
            print(f"Error: User not found.")
            return
        
        print(f"Exporting data for user with IP: {user_to_export.ip_address}")

        user_workspaces = Workspace.query.filter_by(user_id=user_to_export.id).order_by(Workspace.order_index).all()
        workspaces_data = [serialize_workspace(ws) for ws in user_workspaces]
        
        initial_data = {"currentWorkspaceIndex": 0, "workspaces": workspaces_data}
        output_html = render_template('index.html', initial_data=initial_data, mode='STATIC', run_mode=RUN_MODE)
        
        try:
            with open('Todo.html', 'w', encoding='utf-8') as f: f.write(output_html)
            print("\nSuccessfully generated 'Todo.html'")
            print(f"File location: {os.path.join(os.getcwd(), 'Todo.html')}")
        except IOError as e:
            print(f"\nError writing to file: {e}")

# --- 在 "启动逻辑" 注释上方添加这个类 ---

class Api:
    def __init__(self):
        self.window = None

    def export_data(self, data_str):
        if not self.window:
            return

        try:
            # 1. 打开一个原生的 "另存为" 对话框
            file_path = self.window.create_file_dialog(
                webview.SAVE_DIALOG,
                directory=os.path.expanduser('~'), # 默认打开用户主目录
                save_filename='todo_backup.json'
            )

            # 2. 如果用户选择了路径 (没有点取消)
            if file_path:
                # 3. 将从JS接收到的数据写入文件
                with open(file_path[0], 'w', encoding='utf-8') as f:
                    # 美化JSON格式
                    parsed_json = json.loads(data_str)
                    json.dump(parsed_json, f, ensure_ascii=False, indent=2)
                
                # (可选) 可以向JS返回成功状态
                return {"status": "ok", "path": file_path[0]}
        except Exception as e:
            print(f"Error during export: {e}")
            return {"status": "error", "message": str(e)}

    def log_perf(self, message, data=None):
        try:
            payload = data if isinstance(data, dict) else {}
            log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output.log')
            timestamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(f"[perf] {timestamp} {message} {json.dumps(payload, ensure_ascii=False)}\n")
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

# 实例化API
api = Api()


# --- 启动逻辑 ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        ensure_workspace_schema()

    if RUN_MODE == 'STATIC':
        build_static_html()
    elif RUN_MODE == 'SERVER':
        host = '0.0.0.0'
        lan_ip = get_lan_ip()
        print("--- Running in SERVER mode ---")
        print(" * Access URLs:")
        print(f"   - Local:   http://127.0.0.1:{PORT}{ROUTE_PREFIX}/")
        print(f"   - Network: http://{lan_ip}:{PORT}{ROUTE_PREFIX}/")
        print("Press CTRL+C to quit")
        app.run(host=host, port=PORT, debug=True)
    elif RUN_MODE == 'WEBVIEW':
        try:
            import webview
        except ImportError:
            print("\nError: PyWebView is not installed. Please run: pip install \"pywebview[qt]\""); exit(1)
        
        print("--- Running in WEBVIEW mode ---")
        log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output.log')
        noisy_patterns = [
            r'window\.native\.AccessibilityObject',
            r'ControlCollection\.__abstractmethods__',
            r'DockPaddingEdgesConverter\.StandardValuesCollection\.__abstractmethods__',
            r'maximum recursion depth exceeded',
            r'(?:^| )Empty(?:\.Empty)+'
        ]
        sys.stderr = FilteredStream(sys.stderr, noisy_patterns, log_path=log_path)
        logging.getLogger('pywebview').setLevel(logging.ERROR)
        logging.getLogger('pywebview').propagate = False
        
        # --- 修改这里 ---
        # 1. 创建窗口并传入 js_api
        window = webview.create_window(
            "TODO清单", 
            app, 
            width=1280, 
            height=800, 
            resizable=True, 
            min_size=(800, 600),
            js_api=api  # <-- 关键改动：注入API
        )
        
        # 2. 将窗口实例赋给api对象，以便在API方法中使用
        api.window = window
        
        # 3. 启动
        webview.start(debug=False)
    else:
        print(f"Error: Invalid RUN_MODE '{RUN_MODE}'. Please use 'SERVER', 'STATIC', or 'WEBVIEW'.")