(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var form = $("form"), u = $("u"), p = $("p"), err = $("err"),
      submit = $("submit"), eye = $("eye"), devBtn = $("devBtn"),
      devNote = $("devNote"), divider = $("divider");

  function showErr(msg) {
    err.textContent = msg || "";
    err.classList.remove("show");
    if (msg) { void err.offsetWidth; err.classList.add("show"); }
  }

  function post(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.error || ("请求失败 (" + r.status + ")"));
          e.status = r.status;
          e.payload = j;
          throw e;
        }
        return j;
      });
    });
  }

  fetch("/api/config", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (c) {
      var b = c.brand || {};
      var bp = $("bProject");
      if (bp && b.project) bp.textContent = b.project;
      if (c.devLogin) {
        devBtn.hidden = false;
        devNote.hidden = false;
        divider.hidden = false;
      }
    })
    .catch(function () { /* 配置接口不可用时静默 */ });

  eye.addEventListener("click", function () {
    var on = p.type === "password";
    p.type = on ? "text" : "password";
    eye.textContent = on ? "隐藏" : "显示";
    p.focus();
  });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var username = u.value.trim();
    var password = p.value;
    if (!username) { showErr("请输入账号"); u.focus(); return; }
    if (!password) { showErr("请输入密码"); p.focus(); return; }
    showErr("");
    submit.disabled = true;
    submit.textContent = "登录中";
    post("/api/auth/login", { username: username, password: password })
      .then(function () { location.replace("/dashboard"); })
      .catch(function (e) {
        submit.disabled = false;
        submit.textContent = "登 录";
        showErr(e.message);
        p.value = "";
        p.focus();
      });
  });

  devBtn.addEventListener("click", function () {
    devBtn.disabled = true;
    devBtn.textContent = "正在进入…";
    showErr("");
    post("/api/auth/dev-login", {})
      .then(function () { location.replace("/dashboard"); })
      .catch(function (e) {
        devBtn.disabled = false;
        devBtn.textContent = "免密直达（调试通道）";
        showErr(e.message);
      });
  });
})();
