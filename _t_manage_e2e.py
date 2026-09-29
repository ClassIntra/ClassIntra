"""端到端验证 /api/astrbot/manage 的批量封禁能力。

安全性：批量用例使用 user_unban（非破坏性；对已 active 用户为幂等空操作），
不产生任何真实数据变更。全程不打印密钥与姓名。
"""
import json
import os
import sqlite3
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:9001"
ROOT = r"D:\NetWork\Integration\ClassIntra\server"

env = {}
with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

KEY = env.get("ASTRBOT_PUBLISH_KEY", "")
OWNER = (env.get("ADMIN_USER_IDS", "") or "251800").split(",")[0].strip()
assert KEY, "缺少 ASTRBOT_PUBLISH_KEY"

db = sqlite3.connect(os.path.join(ROOT, "database", "classintra.db"))
rows = db.execute(
    "SELECT user_id, net_name FROM users WHERE status='active' AND (is_admin IS NULL OR is_admin=0) "
    "AND net_name IS NOT NULL AND net_name <> '' LIMIT 3"
).fetchall()
assert len(rows) == 3, "active 样本不足"
TARGETS = [r[0] for r in rows]
print("样本（仅学号）:", ", ".join(TARGETS))


def call(method, path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("x-publish-key", KEY)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}


passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("PASS  %s  %s" % (name, detail))
    else:
        failed += 1
        print("FAIL  %s  %s" % (name, detail))


# 1) op 目录已反映新参数说明（证明新代码已加载）
st, r = call("GET", "/api/astrbot/manage/ops")
ban = next((o for o in (r.get("data") or []) if o.get("op") == "user_ban"), None)
check("ops 目录可读", st == 200 and ban is not None, "HTTP %s" % st)
check("user_ban 仍标记为破坏性", bool(ban and ban.get("destructive")), str(ban and ban.get("destructive")))
check("user_ban 参数说明含 targets", bool(ban and "targets" in (ban.get("args") or "")), (ban or {}).get("args", "")[:60])

# 2) 批量：user_unban 三个目标（幂等，无副作用）
#    返回结构：{code,message,data:{op,destructive,desc,status,message,data:<内层>}}
st, r = call("POST", "/api/astrbot/manage", {
    "requester_id": OWNER, "op": "user_unban",
    "params": {"targets": TARGETS}, "confirmed": False,
})
outer = r.get("data") or {}
d = outer.get("data") or {}
check("批量 user_unban HTTP 200", st == 200 and r.get("code") == 200, "HTTP %s %s" % (st, r.get("message")))
check("批量返回 affected=3", d.get("affected") == 3, "outer.message=%s affected=%s total=%s" % (outer.get("message"), d.get("affected"), d.get("total")))
check("批量返回 total=3", d.get("total") == 3, "total=%s" % d.get("total"))
check("批量无失败项", (d.get("failed") or []) == [], json.dumps(d.get("failed"), ensure_ascii=False))
check("批量返回逐条结果", len(d.get("results") or []) == 3, "results=%d" % len(d.get("results") or []))

# 3) 向后兼容：单目标 user_unban（target 字符串）
st, r = call("POST", "/api/astrbot/manage", {
    "requester_id": OWNER, "op": "user_unban",
    "params": {"target": TARGETS[0]}, "confirmed": False,
})
outer = r.get("data") or {}
d = outer.get("data")
check("单目标 user_unban HTTP 200", st == 200 and r.get("code") == 200, "HTTP %s" % st)
check("单目标返回原始 data（非聚合形状）", not (isinstance(d, dict) and ("affected" in d or "failed" in d)), "inner=%s（CI 原生无 data 字段，故为 null，与旧版一致）" % json.dumps(d, ensure_ascii=False))

# 4) 非破坏性读操作未被回归（user_list 的 data 形状保持）
st, r = call("POST", "/api/astrbot/manage", {
    "requester_id": OWNER, "op": "user_list",
    "params": {"content": "active"}, "confirmed": False,
})
d = ((r.get("data") or {}).get("data") or {})
check("user_list 仍返回 users/total 形状", st == 200 and isinstance(d, dict) and "users" in d, "keys=%s" % list(d)[:5])

# 5) 单目标错误语义保持：不存在用户 + 破坏性动作带 confirmed
st, r = call("POST", "/api/astrbot/manage", {
    "requester_id": OWNER, "op": "user_ban",
    "params": {"target": "绝对不存在zzz111"}, "confirmed": True,
})
check("不存在用户 -> 返回失败而非假成功", not (st == 200 and r.get("code") == 200), "HTTP %s %s" % (st, r.get("message")))

# 6) 破坏性动作缺 confirmed -> 必须被拒
st, r = call("POST", "/api/astrbot/manage", {
    "requester_id": OWNER, "op": "user_ban",
    "params": {"targets": TARGETS}, "confirmed": False,
})
check("user_ban 缺 confirmed 被拒", not (st == 200 and r.get("code") == 200), "HTTP %s %s" % (st, r.get("message")))

# 7) 确认三个目标仍为 active（幂等性校验：批量解封未产生副作用）
sts = db.execute(
    "SELECT user_id, status FROM users WHERE user_id IN (%s)" % ",".join("?" * len(TARGETS)), TARGETS
).fetchall()
check("批量解封后样本仍为 active（无副作用）", all(s == "active" for _, s in sts), str(dict(sts)))

print("\n===== %d passed, %d failed =====" % (passed, failed))
raise SystemExit(1 if failed else 0)
