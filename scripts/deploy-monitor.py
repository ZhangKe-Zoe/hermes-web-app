#!/usr/bin/env python3
"""
Deploy Monitor - Polls GitHub Actions and sends Feishu notification when deploy completes.
Usage: python3 deploy-monitor.py <commit_sha> [max_wait_seconds]
"""
import json
import sys
import time
import urllib.request
import urllib.error

GITHUB_REPO = "ZhangKe-Zoe/hermes-web-app"
DEPLOY_WORKFLOW_ID = "286396659"  # deploy.yml
FEISHU_APP_ID = "cli_aa98b933f2b89bed"
FEISHU_APP_SECRET = "cSw6aDqSOZbRq51w64BSTfK31nVPeCG7"
VERCEL_URL = "https://hermes-web-app.vercel.app"

def get_feishu_token():
    data = json.dumps({"app_id": FEISHU_APP_ID, "app_secret": FEISHU_APP_SECRET}).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/",
        data=data, headers={"Content-Type": "application/json"}
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp.get("tenant_access_token")

def send_feishu_message(token, content):
    msg = json.dumps({"receive_id": "", "msg_type": "text", "content": json.dumps({"text": content})}).encode()
    # Use the user's open_id for DM
    open_id = "ou_93cc435b5d5edd2395debcfa3165f814"
    req = urllib.request.Request(
        f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
        data=msg, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        }
    )
    try:
        resp = json.loads(urllib.request.urlopen(req).read())
        return resp.get("code") == 0
    except Exception as e:
        print(f"Feishu send failed: {e}")
        return False

def check_deploy_status(sha=None):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/{DEPLOY_WORKFLOW_ID}/runs?per_page=1"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    try:
        resp = json.loads(urllib.request.urlopen(req).read())
        runs = resp.get("workflow_runs", [])
        if not runs:
            return None, None, None
        run = runs[0]
        return run["status"], run["conclusion"], run["head_sha"]
    except Exception as e:
        print(f"GitHub API error: {e}")
        return None, None, None

def verify_site(url):
    try:
        req = urllib.request.Request(url, method="HEAD")
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.status == 200
    except urllib.error.HTTPError as e:
        return e.code == 200
    except Exception:
        return False

def main():
    sha = sys.argv[1] if len(sys.argv) > 1 else None
    max_wait = int(sys.argv[2]) if len(sys.argv) > 2 else 300  # 5 minutes default
    poll_interval = 15

    print(f"Monitoring deploy for commit {sha or 'latest'}...")
    print(f"Max wait: {max_wait}s, polling every {poll_interval}s")

    start = time.time()
    last_status = None

    while time.time() - start < max_wait:
        status, conclusion, head_sha = check_deploy_status(sha)

        if status != last_status:
            print(f"[{time.strftime('%H:%M:%S')}] Status: {status} / {conclusion}")
            last_status = status

        if status == "completed":
            if conclusion == "success":
                # Verify the site is actually live
                time.sleep(5)  # Wait a bit for Vercel CDN
                site_ok = verify_site(VERCEL_URL + "/rubik-cube")
                
                elapsed = int(time.time() - start)
                if site_ok:
                    msg = f"✅ 部署完成！\n\n🎲 魔方应用已上线\n⏱️ 耗时: {elapsed}秒\n🔗 {VERCEL_URL}/rubik-cube\n\n请刷新浏览器查看最新版本"
                else:
                    msg = f"⚠️ GitHub 部署成功，但站点暂时无法访问\n\n可能是 Vercel CDN 还在传播，请等 1-2 分钟后刷新\n🔗 {VERCEL_URL}/rubik-cube"

                print(msg)
                
                # Send Feishu notification
                try:
                    token = get_feishu_token()
                    if token:
                        send_feishu_message(token, msg)
                        print("Feishu notification sent!")
                except Exception as e:
                    print(f"Notification failed: {e}")
                
                return 0
            else:
                msg = f"❌ 部署失败！\n\n状态: {conclusion}\n请检查 GitHub Actions 日志"
                print(msg)
                try:
                    token = get_feishu_token()
                    if token:
                        send_feishu_message(token, msg)
                except:
                    pass
                return 1

        time.sleep(poll_interval)

    print(f"⏰ 超时 ({max_wait}s)，部署仍在进行中")
    return 2

if __name__ == "__main__":
    sys.exit(main())
