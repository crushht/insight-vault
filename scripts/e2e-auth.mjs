// 账号链路端到端验证：注册（邮箱 + 密码 + 验证码）→ 自动登录 → 会话持久化 → 邮箱密码登录。
//
// 用法：
//   node artifacts/e2e-auth.mjs http://127.0.0.1:3005
//   node artifacts/e2e-auth.mjs http://127.0.0.1:3005 --save-cookie C:\tmp\iv.cookie
//   node artifacts/e2e-auth.mjs http://127.0.0.1:3005 --use-cookie  C:\tmp\iv.cookie
//
// 前提：实例没有配置 SMTP（本地模式 / 开发环境），/api/otp/request 会直接把验证码回给我们。

import fs from "node:fs";

const args = process.argv.slice(2);
const base = (
  args.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005"
).replace(/\/$/, "");
const saveCookieIdx = args.indexOf("--save-cookie");
const useCookieIdx = args.indexOf("--use-cookie");
const saveCookie = saveCookieIdx >= 0 ? args[saveCookieIdx + 1] : null;
const useCookie = useCookieIdx >= 0 ? args[useCookieIdx + 1] : null;

let pass = 0;
let fail = 0;

function ok(name, extra = "") {
  pass++;
  console.log(`PASS  ${name}${extra ? "  <- " + extra : ""}`);
}

function bad(name, extra = "") {
  fail++;
  console.log(`FAIL  ${name}${extra ? "  <- " + extra : ""}`);
}

/** better-auth 对 POST 做同源校验，浏览器会带 Origin，脚本要自己补。 */
const headers = { "content-type": "application/json", origin: base };

function collectCookies(res) {
  return res.headers.getSetCookie?.() ?? [];
}

function cookiePairs(rawCookies) {
  return rawCookies.map((c) => c.split(";")[0]).join("; ");
}

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const email = `e2e-${Date.now()}@example.com`;
const password = "E2ePassw0rd!";

async function main() {
  console.log(`# 目标 ${base}  账号 ${email}`);

  // 0) 登录页可访问
  {
    const res = await fetch(`${base}/signin`);
    if (res.ok) ok("GET /signin", String(res.status));
    else bad("GET /signin", String(res.status));
  }

  // 1) 已保存的 cookie 直接可用（模拟「重开应用」）
  if (useCookie) {
    const cookie = fs.readFileSync(useCookie, "utf8").trim();
    const res = await fetch(`${base}/dashboard/bookmarks`, {
      headers: { cookie },
      redirect: "manual",
    });
    const text = res.status === 200 ? await res.text() : "";
    if (res.status === 200 && !/\/signin/.test(res.url)) {
      ok("复用上次的会话 cookie 直接进收藏库", `${res.status}, ${text.length} 字节`);
    } else {
      bad("复用上次的会话 cookie 直接进收藏库", `status=${res.status} url=${res.url}`);
    }
    return finish();
  }

  // 2) 注册验证码（本地模式应当直接回传）
  let code = null;
  {
    const res = await fetch(`${base}/api/otp/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, purpose: "sign-up" }),
    });
    const data = await json(res);
    if (!res.ok) {
      bad("POST /api/otp/request (sign-up)", `${res.status} ${JSON.stringify(data)}`);
    } else if (data?.delivery === "inline" && data?.code) {
      code = data.code;
      ok("发送注册验证码（本地模式回显）", `code=${code}`);
    } else {
      bad("发送注册验证码", `delivery=${data?.delivery}（实例配置了 SMTP，无法自动取码）`);
    }
  }

  if (!code) {
    return finish();
  }

  // 3) 弱密码应当被拒
  {
    const res = await fetch(`${base}/api/otp/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "E2E", email: `x-${email}`, password: "123", code }),
    });
    if (res.status === 400) ok("弱密码被拒绝", String(res.status));
    else bad("弱密码被拒绝", String(res.status));
  }

  // 4) 错误验证码应当被拒
  {
    const res = await fetch(`${base}/api/otp/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "E2E",
        email,
        password,
        code: code === "000000" ? "111111" : "000000",
      }),
    });
    if (res.status === 401) ok("错误验证码被拒绝", String(res.status));
    else bad("错误验证码被拒绝", String(res.status));
  }

  // 5) 正常注册 → 应当直接拿到 session cookie
  let sessionCookie = "";
  {
    const res = await fetch(`${base}/api/otp/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "E2E test", email, password, code }),
    });
    const data = await json(res);
    const rawCookies = collectCookies(res);
    if (!res.ok) {
      bad("POST /api/otp/register", `${res.status} ${JSON.stringify(data)}`);
      return finish();
    }
    const session = rawCookies.find((c) => /session_token=/i.test(c));
    if (!session) {
      bad("注册后签发 session", "没有 Set-Cookie: session_token");
      return finish();
    }
    const maxAge = /max-age=(\d+)/i.exec(session)?.[1];
    sessionCookie = cookiePairs(rawCookies);
    if (maxAge && Number(maxAge) > 86400) {
      ok("注册后签发 30 天会话 cookie", `Max-Age=${maxAge}s`);
    } else {
      bad("注册后签发 30 天会话 cookie", `Max-Age=${maxAge ?? "缺失（会话级 cookie）"}`);
    }
    if (saveCookie) {
      fs.writeFileSync(saveCookie, sessionCookie, "utf8");
      console.log(`      cookie 已写入 ${saveCookie}`);
    }
  }

  // 6) 带 cookie 访问受保护页面
  {
    const res = await fetch(`${base}/dashboard/bookmarks`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    const text = res.status === 200 ? await res.text() : "";
    if (res.status === 200 && !/\/signin/.test(res.url)) {
      ok("注册后直接进入收藏库（不用再登录）", `${res.status}, ${text.length} 字节`);
    } else {
      bad("注册后直接进入收藏库", `status=${res.status} url=${res.url}`);
    }
  }

  // 7) 邮箱 + 密码登录（已注册账号的常规路径）
  {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password }),
    });
    const rawCookies = collectCookies(res);
    const session = rawCookies.find((c) => /session_token=/i.test(c));
    if (res.ok && session) {
      ok("邮箱 + 密码登录", "200 + session cookie");
      sessionCookie = cookiePairs(rawCookies);
    } else {
      const data = await json(res);
      bad("邮箱 + 密码登录", `${res.status} ${JSON.stringify(data)}`);
    }
  }

  // 8) 错误密码应当被拒
  {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password: "WrongPassword!" }),
    });
    if (!res.ok) ok("错误密码被拒绝", String(res.status));
    else bad("错误密码被拒绝", String(res.status));
  }

  // 9) 重复注册同一邮箱应当被拒（提示去登录）
  {
    const r1 = await fetch(`${base}/api/otp/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, purpose: "sign-up" }),
    });
    const d1 = await json(r1);
    if (r1.status === 409) ok("已注册邮箱不能再走注册", String(r1.status));
    else bad("已注册邮箱不能再走注册", `${r1.status} ${JSON.stringify(d1)}`);
  }

  // 10) 免密码登录验证码（登录用途）仍然可用
  {
    const r1 = await fetch(`${base}/api/otp/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, purpose: "sign-in" }),
    });
    const d1 = await json(r1);
    if (r1.ok && d1?.delivery === "inline" && d1?.code) {
      const r2 = await fetch(`${base}/api/otp/sign-in`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, code: d1.code }),
      });
      const hasCookie = collectCookies(r2).some((c) => /session_token=/i.test(c));
      if (r2.ok && hasCookie) ok("邮箱验证码登录（可选入口）", "200 + session cookie");
      else bad("邮箱验证码登录（可选入口）", String(r2.status));
    } else {
      bad("发送登录验证码", `${r1.status} ${JSON.stringify(d1)}`);
    }
  }

  return finish();
}

function finish() {
  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("E2E 运行异常：", e);
  process.exitCode = 1;
});
