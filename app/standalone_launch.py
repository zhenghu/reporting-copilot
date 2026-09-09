"""Local installation and account detection; never copies credentials."""
import argparse,fcntl,json,os,shutil,subprocess,sys,time,urllib.request
from pathlib import Path
from coordinator import find_codex,codex_env
ROOT=Path(__file__).resolve().parent
DATA=Path.home()/'Library/Application Support/ReportStudio'
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))

def health(port):
    try:
        with OPENER.open(f'http://127.0.0.1:{port}/api/health',timeout=1) as r:
            return json.load(r).get('service')=='report-studio-standalone'
    except (OSError,ValueError):return False

def login(executable):
    env=codex_env()
    try:
        status=subprocess.run([executable,'login','status'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
    except subprocess.TimeoutExpired:
        print('Codex 登录状态检查超时。请打开 Codex 确认登录和网络，再次双击启动。');return False
    if status.returncode==0:
        print('已检测到本机 Codex 登录，无需再次登录。');return True
    print('请在即将打开的官方登录页面登录你自己的账号。工作台不会读取或复制登录凭据。')
    return subprocess.call([executable,'login'],env=env)==0

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--no-open',action='store_true');parser.add_argument('--check',action='store_true');args=parser.parse_args()
    executable=find_codex()
    if args.check:
        print(json.dumps({'python':sys.version.split()[0],'codex_detected':bool(executable),'data_exists':DATA.exists()}));return 0
    DATA.mkdir(parents=True,exist_ok=True)
    port=18776
    with (DATA/'launch.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if not health(port):
            if not executable:
                print('未检测到 Codex。请先安装并登录 Codex Mac 应用，再次双击本启动器。')
                subprocess.run(['open','https://developers.openai.com/codex/app/']);return 1
            if not login(executable):return 1
            target=DATA/'application';shutil.copytree(ROOT,target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
            env=codex_env();env['PATH']=str(Path(sys.executable).parent)+os.pathsep+env.get('PATH','')
            with (DATA/'service.log').open('a') as log:
                child=subprocess.Popen([sys.executable,str(target/'server.py'),'--port',str(port),'--data',str(DATA/'data')],cwd=target,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
            for _ in range(80):
                if health(port):break
                if child.poll() is not None:
                    print('启动失败：端口可能被占用。诊断日志保存在本机 ReportStudio/service.log。');return 1
                time.sleep(.15)
            else:
                print('启动尚未就绪，请稍后重试。');return 1
    if not args.no_open:subprocess.run(['open',f'http://127.0.0.1:{port}/'])
    print('汇报工作台已启动，可以关闭此终端窗口。所有材料仅保存在本机。')
    return 0
if __name__=='__main__':raise SystemExit(main())
